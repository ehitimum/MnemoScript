# Development Commands for MnemoScript

This file lists the commands that should be run to ensure code quality before committing changes.

## Frontend (React + TypeScript)

### Linting
```bash
cd app
npm run lint
```

### Type Checking
```bash
cd app
npm run build  # runs tsc -b && vite build (type check included)
```

Alternatively, run TypeScript compiler directly:
```bash
cd app
npx tsc --noEmit
```

### Formatting
Currently no formatter configured. Consider adding Prettier.

## Backend (Rust)

### Check for compilation errors
```bash
cd app/src-tauri
cargo check
```

### Run tests (if any)
```bash
cargo test
```

### Clippy (additional linting)
```bash
cargo clippy
```

## Full Validation Script

To run all checks before committing, you can create a script `validate.sh` (or PowerShell) that:

1. Run frontend lint
2. Run frontend type check
3. Run Rust check
4. Run Rust tests (if any)

## Notes

- The project uses Tauri 2.x; ensure the Tauri CLI is installed globally or as dev dependency.
- For Windows builds, ensure MSVC toolchain is installed.
- The frontend uses Vite with React plugin; changes to `vite.config.ts` may require restarting dev server.