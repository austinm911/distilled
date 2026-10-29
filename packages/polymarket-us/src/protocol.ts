import * as crypto from "node:crypto";
import * as API from "@distilled.cloud/core/api";
import { type API_ERRORS, ConfigError, type InvalidInput } from "@distilled.cloud/core/errors";
import { makeRestProtocol } from "@distilled.cloud/core/protocol-rest";
/**
 * PolymarketUsProtocol -- hand-written.
 *
 * Polymarket US speaks plain JSON REST, so request building and response
 * decoding are core's `makeRestProtocol`. What is Polymarket US's own:
 *
 * ## Two hosts
 *
 * Public market data lives on `gateway.polymarket.us` and trading and
 * account calls on `api.polymarket.us`, matching the server each of the
 * published per-area documents declares. Incentive programs are documented
 * on the API host but served without auth only by the gateway, while the
 * caller's own incentive earnings need a key; {@link isTradingRoute} routes
 * them apart, as Polymarket's own SDK does.
 *
 * ## Authentication
 *
 * Every call to the API host carries three headers:
 *
 * - `X-PM-Access-Key`: the key ID
 * - `X-PM-Timestamp`: the request time in milliseconds (within 30 seconds of
 *   server time)
 * - `X-PM-Signature`: base64 Ed25519 signature over
 *   `timestamp + METHOD + path`, where path has no query string
 *
 * The secret is base64. Its first 32 bytes are the Ed25519 seed (the
 * developer portal hands out the 64-byte seed + public key form).
 * Gateway calls go out unsigned.
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import type * as HttpClient from "effect/http/HttpClient";
import type * as HttpClientError from "effect/http/HttpClientError";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { type Config, Credentials, type PolymarketUsApiKey } from "./credentials.ts";
import { PolymarketUsParseError, UnknownPolymarketUsError } from "./errors.ts";

/**
 * Error channel shared by every generated Polymarket US operation. Generated
 * service files annotate operations with `API.OperationMethod<I, O,
 * PolymarketUsOpError, PolymarketUsOpContext>` explicitly so the compiler
 * never infers these back out of the schema generics.
 */
export type PolymarketUsOpError =
  | InstanceType<(typeof API_ERRORS)[number]>
  | UnknownPolymarketUsError
  | ConfigError
  | HttpClientError.HttpClientError
  | PolymarketUsParseError
  | InvalidInput;

/** Context (requirements) shared by every generated Polymarket US operation. */
export type PolymarketUsOpContext = Credentials | HttpClient.HttpClient;

/** Route prefixes served by the signed API host. Everything else is gateway market data. */
const TRADING_ROUTE_PREFIXES = [
  "/v1/account/",
  "/v1/orders",
  "/v1/order/",
  "/v1/portfolio/",
  "/v1/rfqs",
  "/v1/incentives/earnings",
] as const;

/** Whether an operation's route (its URI template) belongs to the signed API host. */
export const isTradingRoute = (uri: string): boolean =>
  TRADING_ROUTE_PREFIXES.some((prefix) => uri.startsWith(prefix));

const RestProtocol = /*@__PURE__*/ makeRestProtocol<Config>({
  credentials: /*@__PURE__*/ Effect.flatMap(Credentials, (resolve) => resolve),
  baseUrl: (creds, target) =>
    isTradingRoute(target.uri) ? creds.apiBaseUrl : creds.gatewayBaseUrl,
  // Signing needs the final method and path, so it happens after the
  // request is built (see PolymarketUsProtocol below).
  headers: () => ({}),
  // Error bodies are gRPC-gateway status objects, `{ code, message, details }`,
  // which the default envelope reads.
  unknownError: ({ code, message, body }) =>
    new UnknownPolymarketUsError({
      code: typeof code === "string" ? code : code !== undefined ? String(code) : undefined,
      message,
      body,
    }),
  parseError: ({ body, cause }) => new PolymarketUsParseError({ body, cause }),
});

/** PKCS#8 DER header for a raw 32-byte Ed25519 seed. */
const ED25519_PKCS8_PREFIX = /*@__PURE__*/ Buffer.from("302e020100300506032b657004220420", "hex");

/** The Ed25519 private key in a base64 secret (a 32-byte seed, or seed + public key). */
export const privateKeyFromSecret = (secretKey: string): crypto.KeyObject => {
  const bytes = Buffer.from(secretKey, "base64");
  if (bytes.length !== 32 && bytes.length !== 64) {
    throw new Error(`Polymarket US secret key must decode to 32 or 64 bytes, got ${bytes.length}`);
  }
  return crypto.createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, bytes.subarray(0, 32)]),
    format: "der",
    type: "pkcs8",
  });
};

/** The text Polymarket US signs: `timestamp + METHOD + path`, no host, no query. */
export const preSignText = (timestamp: string, method: string, url: string): string =>
  `${timestamp}${method.toUpperCase()}${new URL(url).pathname}`;

/** The three auth headers for one request. */
export const authHeaders = (
  apiKey: PolymarketUsApiKey,
  method: string,
  url: string,
  nowMillis: number,
): Record<string, string> => {
  const timestamp = String(nowMillis);
  const signature = crypto.sign(
    null,
    Buffer.from(preSignText(timestamp, method, url), "utf8"),
    privateKeyFromSecret(Redacted.value(apiKey.secretKey)),
  );
  return {
    "X-PM-Access-Key": apiKey.keyId,
    "X-PM-Timestamp": timestamp,
    "X-PM-Signature": signature.toString("base64"),
  };
};

const sign = (
  request: HttpClientRequest.HttpClientRequest,
): Effect.Effect<HttpClientRequest.HttpClientRequest> =>
  Effect.withFiber((fiber) => {
    const resolve = Context.get(fiber.context as Context.Context<Credentials>, Credentials);
    return Effect.flatMap(resolve, (creds) => {
      const apiKey = creds.apiKey;
      if (apiKey === undefined || !request.url.startsWith(creds.apiBaseUrl))
        return Effect.succeed(request);
      // A malformed key surfaces as a ConfigError, not a defect.
      return Effect.try({
        try: () =>
          HttpClientRequest.setHeaders(
            request,
            authHeaders(apiKey, request.method, request.url, Date.now()),
          ),
        catch: (cause) =>
          new ConfigError({
            message: `Cannot sign with the configured private key: ${cause instanceof Error ? cause.message : String(cause)}`,
          }),
      });
    });
  }) as Effect.Effect<HttpClientRequest.HttpClientRequest>;

export const PolymarketUsProtocol: Layer.Layer<API.Protocol> = /*@__PURE__*/ Layer.effect(
  API.Protocol,
  /*@__PURE__*/ Effect.map(API.Protocol, (rest) =>
    API.Protocol.of({
      encode: (args) => Effect.flatMap(rest.encode(args), sign),
      decode: rest.decode,
    }),
  ),
).pipe(/*@__PURE__*/ Layer.provide(RestProtocol));
