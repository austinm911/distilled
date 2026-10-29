import * as crypto from "node:crypto";
import * as Effect from "effect/Effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { describe, expect, test } from "vitest";
import { type Config, Credentials } from "../src/credentials.ts";
import { UnknownKalshiError } from "../src/errors.ts";
import type { KalshiOpContext } from "../src/protocol.ts";
import * as Retry from "../src/retry.ts";
import { getBalance, getMarkets } from "../src/services/kalshi.ts";

const BASE_URL = "https://kalshi.test/trade-api/v2";
const KEY_ID = "a952bcbe-ec3b-4b5b-b8f9-11dae589608c";

interface Recorded {
  readonly method: string;
  readonly url: string;
  readonly headers: Record<string, string>;
}

const run = <A, E>(
  operation: Effect.Effect<A, E, KalshiOpContext>,
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

const ed = crypto.generateKeyPairSync("ed25519");
const rsa = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });

const withKey = (privateKey: crypto.KeyObject, type: "pkcs8" | "pkcs1"): Config => ({
  apiKey: {
    keyId: KEY_ID,
    privateKey: Redacted.make(privateKey.export({ format: "pem", type }).toString()),
  },
  apiBaseUrl: BASE_URL,
});

const balance = { balance: 1000, portfolio_value: 1000, updated_ts: 0 };

/** The request's pre-sign text, rebuilt from its own headers. */
const signedText = (request: Recorded, path: string) =>
  `${request.headers["kalshi-access-timestamp"]}${request.method}${path}`;

describe("Kalshi request signing", () => {
  test("signs timestamp + method + path with an Ed25519 key", async () => {
    const { result, requests } = run(
      getBalance({}),
      () => json(balance),
      withKey(ed.privateKey, "pkcs8"),
    );
    await result;
    const [request] = requests;
    expect(request!.headers["kalshi-access-key"]).toBe(KEY_ID);
    expect(request!.headers["kalshi-access-timestamp"]).toMatch(/^\d{13}$/);
    const verified = crypto.verify(
      null,
      Buffer.from(signedText(request!, "/trade-api/v2/portfolio/balance")),
      ed.publicKey,
      Buffer.from(request!.headers["kalshi-access-signature"]!, "base64"),
    );
    expect(verified).toBe(true);
  });

  test("signs with RSA-PSS SHA-256 for an RSA key", async () => {
    const { result, requests } = run(
      getBalance({}),
      () => json(balance),
      withKey(rsa.privateKey, "pkcs1"),
    );
    await result;
    const [request] = requests;
    const verified = crypto.verify(
      "sha256",
      Buffer.from(signedText(request!, "/trade-api/v2/portfolio/balance")),
      {
        key: rsa.publicKey,
        padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
        saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
      },
      Buffer.from(request!.headers["kalshi-access-signature"]!, "base64"),
    );
    expect(verified).toBe(true);
  });

  test("leaves the query string out of the signed path", async () => {
    const { result, requests } = run(
      getMarkets({ limit: 5, status: "open" }),
      () => json({ markets: [], cursor: "" }),
      withKey(ed.privateKey, "pkcs8"),
    );
    await result;
    const [request] = requests;
    expect(new URL(request!.url).search).toContain("limit=5");
    const verified = crypto.verify(
      null,
      Buffer.from(signedText(request!, "/trade-api/v2/markets")),
      ed.publicKey,
      Buffer.from(request!.headers["kalshi-access-signature"]!, "base64"),
    );
    expect(verified).toBe(true);
  });

  test("sends no auth headers without a key", async () => {
    const { result, requests } = run(
      getMarkets({ limit: 1 }),
      () => json({ markets: [], cursor: "" }),
      {
        apiKey: undefined,
        apiBaseUrl: BASE_URL,
      },
    );
    await result;
    expect(Object.keys(requests[0]!.headers).filter((h) => h.startsWith("kalshi-"))).toEqual([]);
  });
});

describe("Kalshi errors", () => {
  test("reads the nested { error: { code, message } } envelope", async () => {
    const { result } = run(
      Effect.flip(getBalance({})),
      () => json({ error: { code: "not_found", message: "not found" } }, 404),
      withKey(ed.privateKey, "pkcs8"),
    );
    const error = await result;
    // getBalance declares no 404, so the shared status class answers; both
    // carry the NotFound tag that catchTag matches.
    expect(error).toMatchObject({ _tag: "NotFound", message: "not found" });
  });

  test("appends the envelope's details to its message", async () => {
    const { result } = run(
      Effect.flip(getBalance({})),
      () =>
        json(
          {
            error: {
              code: "bad_request",
              message: "bad request",
              details: "series_ticker and mve_filter filters are mutually exclusive",
            },
          },
          400,
        ),
      withKey(ed.privateKey, "pkcs8"),
    );
    const error = await result;
    expect(error).toMatchObject({
      message: "bad request: series_ticker and mve_filter filters are mutually exclusive",
    });
  });

  test("falls back to UnknownKalshiError with the code", async () => {
    const { result } = run(
      Effect.flip(getBalance({})),
      () =>
        json(
          {
            error: {
              code: "token_authentication_failure",
              message: "token authentication failure",
            },
          },
          418,
        ),
      withKey(ed.privateKey, "pkcs8"),
    );
    const error = await result;
    expect(error).toBeInstanceOf(UnknownKalshiError);
    expect((error as UnknownKalshiError).code).toBe("token_authentication_failure");
  });
});
