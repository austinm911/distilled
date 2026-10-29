# @distilled.cloud/polymarket-us

Effect-native SDK for the [Polymarket US retail API](https://docs.polymarket.us/api-reference/introduction), generated from the OpenAPI documents Polymarket US publishes for each API area.

This is the CFTC-regulated US exchange (polymarket.us). The international Polymarket CLOB is a different API.

## Installation

```bash
npm install @distilled.cloud/polymarket-us effect
```

## Quick start

Market data is public, so it needs no key:

```ts
import { Effect, Layer } from "effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as PolymarketUs from "@distilled.cloud/polymarket-us";

const program = Effect.gen(function* () {
  const { markets } = yield* PolymarketUs.getMarkets({ limit: 10, active: true, closed: false });
  const book = yield* PolymarketUs.getMarketBook({ slug: markets![0]!.slug! });
  return book.marketData;
});

const Live = Layer.mergeAll(FetchHttpClient.layer, PolymarketUs.anonymous());

program.pipe(Effect.provide(Live), Effect.runPromise);
```

Orders, positions and balances need a key. `PolymarketUs.CredentialsFromEnv` reads it from the environment:

```ts
const Live = Layer.mergeAll(FetchHttpClient.layer, PolymarketUs.CredentialsFromEnv);

const balances = PolymarketUs.getAccountBalances({}).pipe(Effect.provide(Live));
```

## Auth

Optional, both or neither: `POLYMARKET_US_KEY_ID` and `POLYMARKET_US_SECRET_KEY` (the base64 secret from [polymarket.us/developer](https://polymarket.us/developer)). Optional host overrides: `POLYMARKET_US_GATEWAY_BASE_URL` and `POLYMARKET_US_API_BASE_URL`.

Market data goes to `gateway.polymarket.us` unsigned. Orders, portfolio, account, RFQ and incentive-earnings calls go to `api.polymarket.us` with `X-PM-Access-Key`, `X-PM-Timestamp` and `X-PM-Signature`, an Ed25519 signature over the timestamp, the method and the URL path without its query string.

`PolymarketUs.fromApiKey({ keyId, secretKey })` builds the same layer from values you already hold.

## Prices

Prices arrive as decimal strings inside an amount object (`{ "value": "0.4200", "currency": "USD" }`) and quantities as decimal strings. Convert them with a decimal type before doing arithmetic.

## Rate limits

The retail API allows about 25 requests per second per source IP. Callers sharing an egress IP share that budget.

## WebSockets

This package covers the REST API only. The market and private feeds live at `wss://api.polymarket.us/v1/ws/markets` and `wss://api.polymarket.us/v1/ws/private`.
