import * as crypto from "node:crypto";
import { ConfigError } from "@distilled.cloud/core/errors";
import * as Effect from "effect/Effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { describe, expect, test } from "vitest";
import { type Config, Credentials } from "../src/credentials.ts";
import { UnknownPolymarketUsError } from "../src/errors.ts";
import type { PolymarketUsOpContext } from "../src/protocol.ts";
import * as Retry from "../src/retry.ts";
import {
  getAccountBalances,
  getIncentivesEarned,
  getMarketBook,
  getOrder,
  listIncentives,
} from "../src/services/polymarket_us.ts";

const GATEWAY = "https://gateway.test";
const API = "https://api.test";
const KEY_ID = "4b0e5d3c-1f2a-4c6b-9d8e-7a6f5e4d3c2b";

interface Recorded {
  readonly method: string;
  readonly url: string;
  readonly headers: Record<string, string>;
}

const run = <A, E>(
  operation: Effect.Effect<A, E, PolymarketUsOpContext>,
  respond: (request: Recorded) => Response,
  config: Config,
) => {
  const requests: Recorded[] = [];
  const client = HttpClient.make((request) =>
    Effect.sync(() => {
      const recorded = {
        method: request.method,
        url: request.url,
        headers: { ...request.headers },
      };
      requests.push(recorded);
      return HttpClientResponse.fromWeb(request, respond(recorded));
    }),
  );
  const result = Effect.runPromise(
    operation.pipe(
      Retry.none,
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(HttpClient.HttpClient, client),
          Layer.succeed(Credentials, Effect.succeed(config)),
        ),
      ),
    ),
  );
  return { result, requests };
};

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const keys = crypto.generateKeyPairSync("ed25519");
const jwk = keys.privateKey.export({ format: "jwk" });
const seed = Buffer.from(jwk.d ?? "", "base64url");
const publicRaw = Buffer.from(jwk.x ?? "", "base64url");

/** The developer portal's form: base64 of seed + public key (64 bytes). */
const keyed = (secret = Buffer.concat([seed, publicRaw]).toString("base64")): Config => ({
  apiKey: { keyId: KEY_ID, secretKey: Redacted.make(secret) },
  gatewayBaseUrl: GATEWAY,
  apiBaseUrl: API,
});

const anonymous: Config = { apiKey: undefined, gatewayBaseUrl: GATEWAY, apiBaseUrl: API };

const verifies = (request: Recorded, path: string) =>
  crypto.verify(
    null,
    Buffer.from(`${request.headers["x-pm-timestamp"]}${request.method}${path}`),
    keys.publicKey,
    Buffer.from(request.headers["x-pm-signature"] ?? "", "base64"),
  );

describe("Polymarket US routing and signing", () => {
  test("signs API host calls with the Ed25519 seed in a 64-byte secret", async () => {
    const { result, requests } = run(
      getOrder({ orderId: "ord-1" }),
      () => json({ order: { id: "ord-1" } }),
      keyed(),
    );
    await result;
    const [request] = requests;
    expect(request?.url).toBe(`${API}/v1/order/ord-1`);
    expect(request?.headers["x-pm-access-key"]).toBe(KEY_ID);
    expect(request?.headers["x-pm-timestamp"]).toMatch(/^\d{13}$/);
    expect(request && verifies(request, "/v1/order/ord-1")).toBe(true);
  });

  test("accepts a bare 32-byte seed and leaves the query out of the signed path", async () => {
    const { result, requests } = run(
      getIncentivesEarned({ start_date: "2026-10-01" }),
      () => json({}),
      keyed(seed.toString("base64")),
    );
    await result;
    const [request] = requests;
    expect(request?.url).toBe(`${API}/v1/incentives/earnings?start_date=2026-10-01`);
    expect(request && verifies(request, "/v1/incentives/earnings")).toBe(true);
  });

  test("sends market data to the gateway unsigned, even with a key", async () => {
    const { result, requests } = run(
      Effect.all([getMarketBook({ slug: "some-market" }), listIncentives({})]),
      () => json({}),
      keyed(),
    );
    await result;
    expect(requests.map((r) => r.url)).toEqual([
      `${GATEWAY}/v1/markets/some-market/book`,
      `${GATEWAY}/v1/incentives`,
    ]);
    for (const request of requests) {
      expect(Object.keys(request.headers).filter((h) => h.startsWith("x-pm-"))).toEqual([]);
    }
  });

  test("fails with ConfigError for a secret of the wrong length", async () => {
    const { result } = run(
      Effect.flip(getAccountBalances({})),
      () => json({}),
      keyed(Buffer.alloc(16).toString("base64")),
    );
    expect(await result).toBeInstanceOf(ConfigError);
  });
});

describe("Polymarket US errors", () => {
  test("reads the gRPC-gateway { code, message } body", async () => {
    const { result } = run(
      Effect.flip(getAccountBalances({})),
      () => json({ code: 16, message: "User must be authenticated", details: [] }, 401),
      anonymous,
    );
    expect(await result).toMatchObject({ message: "User must be authenticated" });
  });

  test("falls back to UnknownPolymarketUsError for undeclared statuses", async () => {
    const { result } = run(
      Effect.flip(getMarketBook({ slug: "x" })),
      () => json({ code: 13, message: "internal" }, 418),
      anonymous,
    );
    const error = await result;
    expect(error).toBeInstanceOf(UnknownPolymarketUsError);
    expect(error).toMatchObject({ code: "13", message: "internal" });
  });
});
