# Android port

MnemoScript is a Tauri **v2** app, so Android is a first-class target that reuses
the same React frontend **and** the Rust backend — no second framework. The code
has been adapted for mobile; what remains is the one-time toolchain setup and the
`tauri android` build commands (these need an Android SDK/NDK, which can't run in
a headless CI sandbox).

## What was changed for mobile

- **Storage** — `src-tauri/src/project.rs` no longer hard-codes `~/.mnemoscript`
  via the `dirs` crate (which doesn't work in Android's sandbox). A single base
  dir is resolved once at startup (`src-tauri/src/lib.rs` → `setup`):
  - desktop → `~/.mnemoscript` (existing data stays put)
  - mobile  → `app_data_dir()` (the app-private, writable location)
- **Dialogs** — `rfd` (no Android backend) is now a **desktop-only** dependency.
  - `select_directory` returns `None` on mobile (and the UI hides the picker).
  - Image import moved to the cross-platform `@tauri-apps/plugin-dialog` +
    `@tauri-apps/plugin-fs` flow in `src/lib/api.ts`: the frontend picks + reads
    the file (works with Android content URIs) and hands the bytes to the new
    `save_asset` backend command.
- **Capabilities** — `dialog:default`, `fs:default`, and `fs:allow-read-file`
  added in `src-tauri/capabilities/default.json`.
- **Responsive UI** — sidebars collapse to drawers and the menubar becomes a
  hamburger under 768px; desktop-only settings (save path, disk-path picker) are
  hidden on mobile.

## One-time prerequisites

1. **JDK 17** (`java -version` should report 17).
2. **Android Studio** → install SDK Platform, SDK Command-line Tools, NDK, and an
   emulator image (or use a physical device with USB debugging).
3. Environment variables:
   - `ANDROID_HOME` → e.g. `C:\Users\<you>\AppData\Local\Android\Sdk`
   - `NDK_HOME` → e.g. `%ANDROID_HOME%\ndk\<version>`
4. Rust Android targets:
   ```bash
   rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
   ```

## Build & run

From `app/`:

```bash
npm run android:init     # scaffolds src-tauri/gen/android (run once)
npm run android:dev      # build + run on emulator/device with hot reload
npm run android:build    # produce a signed-able APK / AAB
```

(`android:*` are wrappers around `tauri android init|dev|build`.)

## Still to verify on a device

- **PDF export** — `BookCompiler.tsx` triggers export via a hidden iframe +
  `window.print()`. Android's System WebView routes `print()` to the Android
  print framework (incl. "Save as PDF"), but the auto-fired hidden-iframe trick
  needs testing; it may need the Android print API or a JS PDF lib on mobile.
- **Image asset rendering** — saved asset paths render via `convertFileSrc`
  against the `assetProtocol` scope; confirm images display from app storage.
- **Release signing** — generate a keystore and configure
  `src-tauri/gen/android` signing before publishing.
