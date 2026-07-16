# TypeScript rules
- No `any`: use `unknown` plus narrowing, or a proper type. `as` casts need a comment
  justifying them.
- Type-only imports use `import type { ... }`.
- No floating promises: `await`, return, or explicitly `void` with a reason.
- Named exports only; `export default` is reserved for WXT entrypoint definitions
  (`entrypoints/*` — defineBackground/defineContentScript and framework files).
- Model states as discriminated unions instead of boolean flag combinations.
- WXT auto-imports exist, but imports stay explicit: `#imports` for WXT globals
  (browser, defineBackground, …), `@/` for project modules.
