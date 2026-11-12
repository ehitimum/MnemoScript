# MnemoScript — app

The React + TypeScript + Vite frontend and the Tauri (Rust) backend live here. See the repository
root [README](../README.md) for setup, and [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) for the
code map.

| Command | What |
|---|---|
| `npm run dev` | Web preview (browser backend) on port 1420 |
| `npm run dev:tauri` | Desktop app with hot reload |
| `npm run check` | Lint → type check → tests → production build |
| `npm test` / `npm run test:watch` | Vitest unit + regression suites |
| `cargo test` (in `src-tauri/`) | Backend tests |
| `npm run build:tauri` / `npm run android:build` | Installers / APK |
