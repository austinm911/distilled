import * as EffectConfig from "@distilled.cloud/core/config";
import { ConfigError } from "@distilled.cloud/core/errors";
/**
 * Kalshi credentials -- hand-written.
 *
 * The `Credentials` service holds an *effect* that resolves the current
 * credentials on every request (the protocol resolves it on the calling
 * fiber). Kalshi's market data endpoints are public, so a key is optional:
 * without one, requests go out unsigned and portfolio or order endpoints
 * answer 401.
 *
 * A Kalshi API key is an asymmetric pair. The key ID travels in
 * `KALSHI-ACCESS-KEY`; the private key (Ed25519 PKCS#8 PEM, or RSA PKCS#1/#8
 * PEM) signs every request and never leaves the process.
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Redacted from "effect/Redacted";

/** Production Trade API host, the one Kalshi recommends for API traders. */
export const DEFAULT_API_BASE_URL = "https://external-api.kalshi.com/trade-api/v2";
/** Demo environment. Demo keys only work against it. */
export const DEMO_API_BASE_URL = "https://external-api.demo.kalshi.co/trade-api/v2";

/** A Kalshi API key: its ID and its PEM private key. (Named apart from the generated `ApiKey` shape of the api-keys endpoints.) */
export interface KalshiApiKey {
  readonly keyId: string;
  readonly privateKey: Redacted.Redacted<string>;
}

export interface Config {
  /** Absent for public market data calls. */
  readonly apiKey: KalshiApiKey | undefined;
  readonly apiBaseUrl: string;
}

export class Credentials
  extends /*@__PURE__*/ Context.Service<Credentials, Effect.Effect<Config, ConfigError>>()(
    "KalshiCredentials",
  ) {}

/** Layer from an API key and an optional base URL (default production). */
export const fromApiKey = (config: {
  readonly keyId: string;
  readonly privateKey: Redacted.Redacted<string>;
  readonly apiBaseUrl?: string;
}): Layer.Layer<Credentials> =>
  Layer.succeed(
    Credentials,
    Effect.succeed({
      apiKey: { keyId: config.keyId, privateKey: config.privateKey },
      apiBaseUrl: config.apiBaseUrl ?? DEFAULT_API_BASE_URL,
    }),
  );

/** Layer for unauthenticated market data calls. */
export const anonymous = (config?: { readonly apiBaseUrl?: string }): Layer.Layer<Credentials> =>
  Layer.succeed(
    Credentials,
    Effect.succeed({
      apiKey: undefined,
      apiBaseUrl: config?.apiBaseUrl ?? DEFAULT_API_BASE_URL,
    }),
  );

const envConfig = /*@__PURE__*/ EffectConfig.all({
  keyId: /*@__PURE__*/ EffectConfig.option(/*@__PURE__*/ EffectConfig.String("KALSHI_API_KEY_ID")),
  privateKey: /*@__PURE__*/ EffectConfig.option(
    /*@__PURE__*/ EffectConfig.Redacted("KALSHI_PRIVATE_KEY"),
  ),
  apiBaseUrl: /*@__PURE__*/ EffectConfig.option(
    /*@__PURE__*/ EffectConfig.String("KALSHI_API_BASE_URL"),
  ),
});

/**
 * Reads `KALSHI_API_KEY_ID` and `KALSHI_PRIVATE_KEY` (both or neither) and
 * the optional `KALSHI_API_BASE_URL`. With neither key variable set, calls go
 * out unsigned.
 */
export const CredentialsFromEnv: Layer.Layer<Credentials> = /*@__PURE__*/ Layer.succeed(
  Credentials,
  /*@__PURE__*/ Effect.gen(function* () {
    // A ConfigProvider that cannot read its source fails with SourceError;
    // surface it as the ConfigError every credentials effect declares.
    const config = yield* envConfig.pipe(
      Effect.mapError((error) => new ConfigError({ message: error.message })),
    );
    const keyId = Option.getOrUndefined(config.keyId);
    const privateKey = Option.getOrUndefined(config.privateKey);
    if ((keyId === undefined) !== (privateKey === undefined)) {
      return yield* new ConfigError({
        message: "Set both KALSHI_API_KEY_ID and KALSHI_PRIVATE_KEY, or neither",
      });
    }
    return {
      apiKey: keyId !== undefined && privateKey !== undefined ? { keyId, privateKey } : undefined,
      apiBaseUrl: Option.getOrElse(config.apiBaseUrl, () => DEFAULT_API_BASE_URL),
    };
  }),
);
