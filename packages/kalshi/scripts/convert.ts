#!/usr/bin/env -S node --conditions=bun
/**
 * convert — turn the Kalshi Trade API OpenAPI spec into a Smithy 2.0 JSON model.
 *
 * Input:  specs/spec-mirror-kalshi/specs/openapi.json  (spec submodule; the
 *         mirror converts Kalshi's published openapi.yaml to JSON)
 * Output: .generated-specs/kalshi.json
 *
 * The OpenAPI→Smithy converter lives in
 * `@distilled.cloud/dev/codegen/openapi`; this script is Kalshi's pipeline
 * config. `scripts/generate.ts` compiles the model into src/services.
 */
import * as path from "node:path";
import { runOpenApiConvert } from "@distilled.cloud/dev/codegen/openapi-cli";

await runOpenApiConvert({
  root: path.resolve(import.meta.dirname, ".."),
  specs: [
    {
      name: "kalshi",
      specPath: "specs/spec-mirror-kalshi/specs/openapi.json",
    },
  ],
  patchesDir: false,
  options: {
    namespace: "com.kalshi.trade",
    serviceName: "Kalshi",
    skipDeprecated: true,
  },
});
