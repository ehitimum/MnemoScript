# Development Commands for MnemoScript

Run these before committing. CI (`.github/workflows/ci.yml`) runs the same steps on every push.

## Frontend (React + TypeScript) — run inside `app/`

```bash
npm run lint            # ESLint (must be 0 errors — React Compiler rules are enforced)
npm run typecheck       # tsc -b (includes the test files)
npm test                # Vitest: unit + regression suites (jsdom)
npm run test:regression # only the mounted-component regression suites
npm run build           # vite production build
npm run check           # all of the above in order
```

Dependencies are installed with `npm install --legacy-peer-deps` (TipTap peer ranges).

## Backend (Rust) — run inside `app/src-tauri/`

```bash
cargo check
cargo test              # needs ../dist (run the frontend build first)
cargo clippy -- -D warnings
```

## Conventions

- Never read `ref.current` during render or call setState synchronously in an effect body (the
  React Compiler lint rules will fail the build). Mirror ref values into state when the render needs them.
- Every bug fix gets a regression test under `app/src/regression/` (see `docs/TESTING.md`).
- Keep the desktop and phone shells separate (`lib/platform.ts` decides which one renders).
- Docs to keep current: `docs/ARCHITECTURE.md` (structure), `docs/DEVLOG.md` (dated changes),
  `docs/IMPROVEMENT_PLAN.md` (status + roadmap).
