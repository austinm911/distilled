#!/usr/bin/env -S node --conditions=bun
/**
 * convert — turn the Polymarket US retail API OpenAPI spec into a Smithy 2.0 JSON model.
 *
 * Input:  specs/spec-mirror-polymarket-us/specs/openapi.json  (spec submodule; the
 *         mirror merges the per-area documents Polymarket US publishes)
 * Output: .generated-specs/polymarket_us.json
 *
 * The OpenAPI→Smithy converter lives in
 * `@distilled.cloud/dev/codegen/openapi`; this script is Polymarket US's pipeline
 * config. `scripts/generate.ts` compiles the model into src/services.
 */
import * as path from "node:path";
import { runOpenApiConvert } from "@distilled.cloud/dev/codegen/openapi-cli";
import type { OperationIdContext } from "@distilled.cloud/dev/codegen/rewrite-operation-ids";

/**
 * Operation ids are gRPC-gateway `Service_Method` (`MarketService_GetMarkets`,
 * `RFQAPI_CreateQuote`). The method is already verbNoun, so the service
 * prefix is dropped (`getMarkets`, `createQuote`). The legacy v1 sports
 * service and the v2 one both have `GetSports`; the v1 route takes a
 * `Legacy` suffix.
 */
/**
 * The gateway serializes protobuf messages with unset message-typed fields
 * as `null` (`"assetPriceTerms": null`, `"hub": null`), which the documents
 * do not declare. Every optional property that references an object schema
 * is marked nullable so a lenient read types it honestly and a validating
 * read accepts it. Scalars and repeated fields are emitted as zero values
 * and keep their declared types.
 */
const nullableMessageFields = (spec: any): void => {
  const schemas: Record<string, any> = spec.components?.schemas ?? {};
  const isMessage = (node: any): boolean => {
    const name = typeof node?.$ref === "string" ? node.$ref.split("/").pop() : undefined;
    const target = name === undefined ? undefined : schemas[name];
    return target?.type === "object" || target?.properties !== undefined;
  };
  const seen = new Set<unknown>();
  const visit = (node: any): void => {
    if (node === null || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    if (node.properties !== undefined) {
      const required = new Set<string>(Array.isArray(node.required) ? node.required : []);
      for (const [name, property] of Object.entries<any>(node.properties)) {
        if (!required.has(name) && isMessage(property)) property.nullable = true;
      }
    }
    for (const child of Object.values(node)) visit(child);
  };
  visit(spec);
};

const operationName = (operationId: string, ctx: OperationIdContext): string => {
  const method = operationId.slice(operationId.indexOf("_") + 1);
  const name = method.charAt(0).toLowerCase() + method.slice(1);
  return ctx.method.toUpperCase() === "GET" && ctx.path === "/v1/sports" ? `${name}Legacy` : name;
};

await runOpenApiConvert({
  root: path.resolve(import.meta.dirname, ".."),
  specs: [
    {
      name: "polymarket_us",
      specPath: "specs/spec-mirror-polymarket-us/specs/openapi.json",
      preprocess: nullableMessageFields,
    },
  ],
  patchesDir: false,
  options: {
    namespace: "com.polymarket.us",
    serviceName: "PolymarketUs",
    skipDeprecated: true,
    operationNames: operationName,
  },
});
