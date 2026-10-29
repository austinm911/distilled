# @distilled.cloud/kalshi

Effect-native SDK for the [Kalshi Trade API](https://docs.kalshi.com), generated from Kalshi's published OpenAPI spec.

## Installation

```bash
npm install @distilled.cloud/kalshi effect
```

## Quick start

Market data is public, so it needs no key:

```ts
import { Effect, Layer } from "effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Kalshi from "@distilled.cloud/kalshi";

const program = Effect.gen(function* () {
  const { markets } = yield* Kalshi.getMarkets({ status: "open", limit: 10 });
  const book = yield* Kalshi.getMarketOrderbook({ ticker: markets[0]!.ticker, depth: 5 });
  return book.orderbook_fp;
});

const Live = Layer.mergeAll(FetchHttpClient.layer, Kalshi.anonymous());

program.pipe(Effect.provide(Live), Effect.runPromise);
```

Portfolio and order calls need a key. `Kalshi.CredentialsFromEnv` reads it from the environment:

```ts
const Live = Layer.mergeAll(FetchHttpClient.layer, Kalshi.CredentialsFromEnv);

const balance = Kalshi.getBalance({}).pipe(Effect.provide(Live));
```

## Auth

Optional, both or neither: `KALSHI_API_KEY_ID` and `KALSHI_PRIVATE_KEY` (the PEM private key Kalshi gave you when you created the key). Optional: `KALSHI_API_BASE_URL`, which defaults to production. Use `Kalshi.DEMO_API_BASE_URL` for the demo exchange.

Every request with a key carries `KALSHI-ACCESS-KEY`, `KALSHI-ACCESS-TIMESTAMP` and `KALSHI-ACCESS-SIGNATURE`. The signature covers the timestamp, the method and the URL path without its query string. Ed25519 keys sign it directly and RSA keys use RSA-PSS with SHA-256, picked from the key's type. Without a key, requests go out unsigned.

`Kalshi.fromApiKey({ keyId, privateKey, apiBaseUrl? })` builds the same layer from values you already hold.

## Prices and quantities

Kalshi reports prices as fixed-point dollar strings (`yes_bid_dollars: "0.4200"`) and counts as fixed-point strings (`*_fp`). The SDK keeps them as strings, so convert them with a decimal type before doing arithmetic.

## Errors

Kalshi returns `{ "error": { "code", "message" } }` on failure. Statuses the spec declares map to typed errors (`BadRequest`, `NotFound`, `Conflict`, ...), and anything else becomes `UnknownKalshiError` with Kalshi's `code`.

## WebSockets

This package covers the REST API only. Kalshi's WebSocket feed is described in its [AsyncAPI spec](https://docs.kalshi.com/asyncapi.yaml).
