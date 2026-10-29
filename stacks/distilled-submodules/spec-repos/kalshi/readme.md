# spec-mirror-kalshi

A git mirror of the Kalshi Trade API [OpenAPI spec](https://docs.kalshi.com/openapi.yaml), reduced to exactly the file the
[`@distilled.cloud/kalshi`](https://github.com/alchemy-run/distilled) generator reads:

- `specs/openapi.json` — `openapi.yaml`, converted to JSON

Only the REST description is mirrored, so this repository stays small
enough to use as a git submodule.

The mirror is updated every 24 hours by
[`.github/workflows/update-specs.yml`](./.github/workflows/update-specs.yml).

## Usage as a submodule

```sh
git submodule add https://github.com/distilled-mirror/spec-mirror-kalshi.git
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
