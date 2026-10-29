#!/usr/bin/env node
/**
 * Fetches the Kalshi Trade API OpenAPI spec to ../specs/.
 *
 * Kalshi publishes one OpenAPI 3 document as YAML at a stable docs URL, the
 * source its own documentation renders. Kalshi tells API traders to generate
 * their own client from it. It is parsed here and written as JSON so the
 * package's convert step needs no YAML parser.
 *
 * The WebSocket AsyncAPI document (https://docs.kalshi.com/asyncapi.yaml) is
 * not mirrored: the generator reads only the REST description.
 *
 * Usage:
 *   node fetch-specs.ts
 *
 * The spec is saved to:
 *   ../specs/openapi.json
 */

const OPENAPI_SPEC_URL = "https://docs.kalshi.com/openapi.yaml";
const SPECS_DIR = "../specs";
const OUTPUT_PATH = `${SPECS_DIR}/openapi.json`;

import { existsSync, mkdirSync } from "fs";
import { writeFile } from "fs/promises";
import YAML from "yaml";

if (!existsSync(SPECS_DIR)) {
  mkdirSync(SPECS_DIR, { recursive: true });
}

async function main() {
  console.log(`Fetching OpenAPI spec from ${OPENAPI_SPEC_URL}...`);

  const response = await fetch(OPENAPI_SPEC_URL, {
    headers: { "user-agent": "distilled.cloud-kalshi-spec-mirror" },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch OpenAPI spec: ${response.status} ${response.statusText}`);
  }

  const spec = YAML.parse(await response.text()) as Record<string, unknown>;

  // A docs error page can still parse as YAML; fail before the generator does.
  if (typeof spec?.openapi !== "string" || spec.paths === undefined) {
    throw new Error(
      `${OPENAPI_SPEC_URL} returned a document without \`openapi\`/\`paths\` — not an OpenAPI document`,
    );
  }

  console.log(`Writing spec to ${OUTPUT_PATH}...`);
  await writeFile(OUTPUT_PATH, JSON.stringify(spec, null, 2) + "\n");

  console.log(`Done! OpenAPI ${spec.openapi} — ${Object.keys(spec.paths as object).length} paths`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
