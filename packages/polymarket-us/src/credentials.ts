import * as EffectConfig from "@distilled.cloud/core/config";
import { ConfigError } from "@distilled.cloud/core/errors";
/**
 * Polymarket US credentials -- hand-written.
 *
 * The `Credentials` service holds an *effect* that resolves the current
 * credentials on every request (the protocol resolves it on the calling
 * fiber). Market data is public, so a key is optional: without one, the
 * trading and account calls answer 401.
 *
 * A Polymarket US API key is a key ID plus a base64 Ed25519 secret, both
 * from polymarket.us/developer. The secret signs every authenticated request
 * and never leaves the process.
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Redacted from "effect/Redacted";

/** Public market data host. */
export const DEFAULT_GATEWAY_BASE_URL = "https://gateway.polymarket.us";
/** Signed trading and account host. */
export const DEFAULT_API_BASE_URL = "https://api.polymarket.us";

/** A Polymarket US API key: its ID and its base64 Ed25519 secret. */
export interface PolymarketUsApiKey {
  readonly keyId: string;
  readonly secretKey: Redacted.Redacted<string>;
}

export interface Config {
  /** Absent for public market data calls. */
  readonly apiKey: PolymarketUsApiKey | undefined;
  readonly gatewayBaseUrl: string;
  readonly apiBaseUrl: string;
}

export class Credentials
  extends /*@__PURE__*/ Context.Service<Credentials, Effect.Effect<Config, ConfigError>>()(
    "PolymarketUsCredentials",
  ) {}

/** Layer from an API key, with optional host overrides. */
export const fromApiKey = (config: {
  readonly keyId: string;
  readonly secretKey: Redacted.Redacted<string>;
  readonly gatewayBaseUrl?: string;
  readonly apiBaseUrl?: string;
}): Layer.Layer<Credentials> =>
  Layer.succeed(
    Credentials,
    Effect.succeed({
      apiKey: { keyId: config.keyId, secretKey: config.secretKey },
      gatewayBaseUrl: config.gatewayBaseUrl ?? DEFAULT_GATEWAY_BASE_URL,
      apiBaseUrl: config.apiBaseUrl ?? DEFAULT_API_BASE_URL,
    }),
  );

/** Layer for unauthenticated market data calls. */
export const anonymous = (config?: {
  readonly gatewayBaseUrl?: string;
  readonly apiBaseUrl?: string;
}): Layer.Layer<Credentials> =>
  Layer.succeed(
    Credentials,
    Effect.succeed({
      apiKey: undefined,
      gatewayBaseUrl: config?.gatewayBaseUrl ?? DEFAULT_GATEWAY_BASE_URL,
      apiBaseUrl: config?.apiBaseUrl ?? DEFAULT_API_BASE_URL,
    }),
  );

const envConfig = /*@__PURE__*/ EffectConfig.all({
  keyId: /*@__PURE__*/ EffectConfig.option(
    /*@__PURE__*/ EffectConfig.String("POLYMARKET_US_KEY_ID"),
  ),
  secretKey: /*@__PURE__*/ EffectConfig.option(
    /*@__PURE__*/ EffectConfig.Redacted("POLYMARKET_US_SECRET_KEY"),
  ),
  gatewayBaseUrl: /*@__PURE__*/ EffectConfig.option(
    /*@__PURE__*/ EffectConfig.String("POLYMARKET_US_GATEWAY_BASE_URL"),
  ),
  apiBaseUrl: /*@__PURE__*/ EffectConfig.option(
    /*@__PURE__*/ EffectConfig.String("POLYMARKET_US_API_BASE_URL"),
  ),
});

/**
 * Reads `POLYMARKET_US_KEY_ID` and `POLYMARKET_US_SECRET_KEY` (both or
 * neither) and the optional `POLYMARKET_US_GATEWAY_BASE_URL` and
 * `POLYMARKET_US_API_BASE_URL`. With neither key variable set, calls go out
 * unsigned.
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
    const secretKey = Option.getOrUndefined(config.secretKey);
    if ((keyId === undefined) !== (secretKey === undefined)) {
      return yield* new ConfigError({
        message: "Set both POLYMARKET_US_KEY_ID and POLYMARKET_US_SECRET_KEY, or neither",
      });
    }
    return {
      apiKey: keyId !== undefined && secretKey !== undefined ? { keyId, secretKey } : undefined,
      gatewayBaseUrl: Option.getOrElse(config.gatewayBaseUrl, () => DEFAULT_GATEWAY_BASE_URL),
      apiBaseUrl: Option.getOrElse(config.apiBaseUrl, () => DEFAULT_API_BASE_URL),
    };
  }),
);
