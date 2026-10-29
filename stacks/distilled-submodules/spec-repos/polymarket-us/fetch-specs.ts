#!/usr/bin/env node
/**
 * Fetches the Polymarket US retail API OpenAPI documents to ../specs/.
 *
 * Polymarket US publishes one OpenAPI 3 fragment per API area under
 * docs.polymarket.us/api-reference/oapi-schemas/ (the documents its own API
 * reference renders). Each declares one server:
 *
 * - gateway.polymarket.us: public market data (events, markets, series,
 *   sports, tags, search, price history, incentive programs)
 * - api.polymarket.us: signed trading and account calls (orders, portfolio,
 *   account, RFQs)
 *
 * Every fragment is mirrored verbatim under ../specs/raw/, and the set is
 * merged into one document, ../specs/openapi.json, which the generator
 * reads. The merge keeps each path's server as a path-level `servers` entry
 * and each fragment's document-level `security` on its operations, so
 * routing and auth stay visible. The fragments embed copies of the same
 * component schemas at different revisions (some carry fields others lack),
 * so a schema defined in several fragments is merged: properties and enum
 * values are unioned, and a property is required only where every copy
 * requires it.
 *
 * The institutional API (/institutional/oapi-schemas/) is a separate product
 * for FCMs and is not mirrored.
 *
 * Usage:
 *   node fetch-specs.ts
 *
 * The specs are saved to:
 *   ../specs/raw/<area>-schema.json
 *   ../specs/openapi.json
 */

import { existsSync, mkdirSync } from "fs";
import { writeFile } from "fs/promises";

const BASE_URL = "https://docs.polymarket.us/api-reference/oapi-schemas";
const SPECS_DIR = "../specs";
const RAW_DIR = `${SPECS_DIR}/raw`;
const OUTPUT_PATH = `${SPECS_DIR}/openapi.json`;

/** Retail API areas, in merge order: an earlier area's copy of a schema wins property conflicts. */
const AREAS = [
  "markets",
  "events",
  "series",
  "sports",
  "sports-legacy",
  "tags",
  "search",
  "price-history",
  "asset-prices",
  "incentives",
  "account",
  "orders",
  "portfolio",
  "rfqs",
] as const;

const HTTP_METHODS = new Set(["get", "put", "post", "delete", "patch", "head", "options"]);

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Merge two copies of one component schema (see the header). */
const mergeSchema = (into: Json, from: Json): Json => {
  const merged: Json = { ...into };
  if (isObject(into.properties) && isObject(from.properties)) {
    merged.properties = { ...from.properties, ...into.properties };
    const required = (value: unknown) =>
      new Set(Array.isArray(value) ? value.filter((v) => typeof v === "string") : []);
    const left = required(into.required);
    const right = required(from.required);
    const both = [...left].filter((name) => right.has(name));
    if (both.length > 0) merged.required = both;
    else delete merged.required;
  }
  if (Array.isArray(into.enum) && Array.isArray(from.enum)) {
    merged.enum = [...new Set([...into.enum, ...from.enum])];
  }
  return merged;
};

if (!existsSync(RAW_DIR)) {
  mkdirSync(RAW_DIR, { recursive: true });
}

async function fetchArea(area: string): Promise<Json> {
  const url = `${BASE_URL}/${area}-schema.json`;
  const response = await fetch(url, {
    headers: { "user-agent": "distilled.cloud-polymarket-us-spec-mirror" },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  const spec: unknown = await response.json();
  // A docs error page can still parse as JSON; fail before the generator does.
  if (!isObject(spec) || typeof spec.openapi !== "string" || !isObject(spec.paths)) {
    throw new Error(`${url} returned a document without \`openapi\`/\`paths\``);
  }
  return spec;
}

async function main() {
  const merged = {
    openapi: "3.0.3",
    info: {
      title: "Polymarket US Retail API",
      description:
        "Merged from the per-area documents at " +
        `${BASE_URL}/<area>-schema.json by the spec mirror.`,
      version: "v1",
    },
    servers: [{ url: "https://gateway.polymarket.us" }],
    paths: {} as Json,
    components: { schemas: {} as Json, securitySchemes: {} as Json },
  };

  for (const area of AREAS) {
    console.log(`Fetching ${area}...`);
    const spec = await fetchArea(area);
    await writeFile(`${RAW_DIR}/${area}-schema.json`, JSON.stringify(spec, null, 2) + "\n");

    const servers = spec.servers;
    const security = spec.security;
    for (const [path, item] of Object.entries(spec.paths as Json)) {
      if (!isObject(item)) continue;
      // The same route can appear in two areas (portfolio re-documents
      // account balances); the first area that documents it owns it.
      if (path in merged.paths) continue;
      const pathItem: Json = { ...item, servers };
      for (const [method, operation] of Object.entries(item)) {
        if (HTTP_METHODS.has(method) && isObject(operation) && security !== undefined) {
          pathItem[method] = { security, ...operation };
        }
      }
      merged.paths[path] = pathItem;
    }

    const components = isObject(spec.components) ? spec.components : {};
    for (const [name, schema] of Object.entries(
      isObject(components.schemas) ? components.schemas : {},
    )) {
      if (!isObject(schema)) continue;
      const existing = merged.components.schemas[name];
      merged.components.schemas[name] = isObject(existing) ? mergeSchema(existing, schema) : schema;
    }
    Object.assign(
      merged.components.securitySchemes,
      isObject(components.securitySchemes) ? components.securitySchemes : {},
    );
  }

  console.log(`Writing merged spec to ${OUTPUT_PATH}...`);
  await writeFile(OUTPUT_PATH, JSON.stringify(merged, null, 2) + "\n");
  console.log(
    `Done! ${AREAS.length} documents, ${Object.keys(merged.paths).length} paths, ` +
      `${Object.keys(merged.components.schemas).length} schemas`,
  );
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
