# spec-mirror-polymarket-us

A git mirror of the Polymarket US retail API [OpenAPI documents](https://docs.polymarket.us/api-reference/introduction), reduced to exactly the files the
[`@distilled.cloud/polymarket-us`](https://github.com/alchemy-run/distilled) generator reads:

- `specs/raw/<area>-schema.json`: each per-area document, verbatim
- `specs/openapi.json`: the documents merged into one, with each path's server and security kept

Only the retail REST description is mirrored, so this repository stays small
enough to use as a git submodule.

The mirror is updated every 24 hours by
[`.github/workflows/update-specs.yml`](./.github/workflows/update-specs.yml).

## Usage as a submodule

```sh
git submodule add https://github.com/distilled-mirror/spec-mirror-polymarket-us.git
```

## Updating specs

From `.meta/`:

```sh
pnpm install
pnpm run fetch-specs
```

---

This repository is managed by the `distilled-submodules` Alchemy stack in
[alchemy-run/distilled](https://github.com/alchemy-run/distilled) (`stacks/distilled-submodules`).
Its scaffolding is generated — edit it there, not here.
