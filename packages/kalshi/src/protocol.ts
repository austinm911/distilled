import * as crypto from "node:crypto";
import * as API from "@distilled.cloud/core/api";
import { type API_ERRORS, ConfigError, type InvalidInput } from "@distilled.cloud/core/errors";
import { makeRestProtocol } from "@distilled.cloud/core/protocol-rest";
/**
 * KalshiProtocol -- hand-written.
 *
 * Kalshi speaks plain JSON REST, so request building and response decoding
 * are core's `makeRestProtocol`. What is Kalshi's own:
 *
 * ## Authentication
 *
 * Every authenticated request carries three headers:
 *
 * - `KALSHI-ACCESS-KEY`: the API key ID
 * - `KALSHI-ACCESS-TIMESTAMP`: the request time in milliseconds
 * - `KALSHI-ACCESS-SIGNATURE`: base64 of a signature over
 *   `timestamp + METHOD + path`, where path is the URL path from the host
 *   (`/trade-api/v2/portfolio/orders`) without the query string
 *
 * Ed25519 keys sign that text directly; RSA keys use RSA-PSS with SHA-256,
 * MGF1-SHA-256 and a salt as long as the digest. Kalshi picks the algorithm
 * from the registered public key, so the private key's type decides here too.
 * Without a key the request goes out unsigned, which the public market data
 * endpoints accept.
 *
 * ## Errors
 *
 * Kalshi wraps non-2xx bodies as `{ "error": { "code", "message", "details"? } }`.
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import type * as HttpClient from "effect/http/HttpClient";
import type * as HttpClientError from "effect/http/HttpClientError";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { type KalshiApiKey, type Config, Credentials } from "./credentials.ts";
import { KalshiParseError, UnknownKalshiError } from "./errors.ts";

/**
 * Error channel shared by every generated Kalshi operation. Generated service
 * files annotate operations with `API.OperationMethod<I, O, KalshiOpError,
 * KalshiOpContext>` explicitly so the compiler never infers these back out of
 * the schema generics.
 */
export type KalshiOpError =
  | InstanceType<(typeof API_ERRORS)[number]>
  | UnknownKalshiError
  | ConfigError
  | HttpClientError.HttpClientError
  | KalshiParseError
  | InvalidInput;

/** Context (requirements) shared by every generated Kalshi operation. */
export type KalshiOpContext = Credentials | HttpClient.HttpClient;

/** Kalshi's error body: `{ error: { code, message, details? } }`. */
const errorEnvelope = (body: unknown) => {
  if (body === null || typeof body !== "object") return undefined;
  const inner = (body as { error?: unknown }).error;
  if (inner === null || typeof inner !== "object") return undefined;
  const { code, message } = inner as { code?: unknown; message?: unknown };
  return {
    code: typeof code === "string" ? code : undefined,
    message: typeof message === "string" ? message : undefined,
  };
};

const RestProtocol = /*@__PURE__*/ makeRestProtocol<Config>({
  credentials: /*@__PURE__*/ Effect.flatMap(Credentials, (resolve) => resolve),
  baseUrl: (creds) => creds.apiBaseUrl,
  // Signing needs the method and path, so it happens after the request is
  // built (see KalshiProtocol below), not in these static headers.
  headers: () => ({}),
  errorEnvelope,
  unknownError: ({ code, message, body }) =>
    new UnknownKalshiError({
      code: typeof code === "string" ? code : code !== undefined ? String(code) : undefined,
      message,
      body,
    }),
  parseError: ({ body, cause }) => new KalshiParseError({ body, cause }),
});

/** The text Kalshi signs: `timestamp + METHOD + path`, no host, no query. */
export const preSignText = (timestamp: string, method: string, url: string): string =>
  `${timestamp}${method.toUpperCase()}${new URL(url).pathname}`;

/** Base64 signature of `text` with an Ed25519 or RSA PEM private key. */
export const signText = (privateKeyPem: string, text: string): string => {
  const key = crypto.createPrivateKey(privateKeyPem);
  const data = Buffer.from(text, "utf8");
  const signature =
    key.asymmetricKeyType === "ed25519"
      ? crypto.sign(null, data, key)
      : crypto.sign("sha256", data, {
          key,
          padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
          saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
        });
  return signature.toString("base64");
};

/** The three auth headers for one request. */
export const authHeaders = (
  apiKey: KalshiApiKey,
  method: string,
  url: string,
  nowMillis: number,
): Record<string, string> => {
  const timestamp = String(nowMillis);
  return {
    "KALSHI-ACCESS-KEY": apiKey.keyId,
    "KALSHI-ACCESS-TIMESTAMP": timestamp,
    "KALSHI-ACCESS-SIGNATURE": signText(
      Redacted.value(apiKey.privateKey),
      preSignText(timestamp, method, url),
    ),
  };
};

const sign = (
  request: HttpClientRequest.HttpClientRequest,
): Effect.Effect<HttpClientRequest.HttpClientRequest> =>
  Effect.withFiber((fiber) => {
    const resolve = Context.get(fiber.context as Context.Context<Credentials>, Credentials);
    return Effect.flatMap(resolve, (creds) => {
      const apiKey = creds.apiKey;
      if (apiKey === undefined) return Effect.succeed(request);
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

export const KalshiProtocol: Layer.Layer<API.Protocol> = /*@__PURE__*/ Layer.effect(
  API.Protocol,
  /*@__PURE__*/ Effect.map(API.Protocol, (rest) =>
    API.Protocol.of({
      encode: (args) => Effect.flatMap(rest.encode(args), sign),
      decode: rest.decode,
    }),
  ),
).pipe(/*@__PURE__*/ Layer.provide(RestProtocol));
