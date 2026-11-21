# SeaGlass Studio

SeaGlass Studio is an offline-first digital painting app. Paint with customizable brushes, organize work with layers and groups, edit text, and arrange the workspace around your canvas. Save editable `.seaglass` projects or export PNGs.

## Windows beta

The planned `0.1.0-beta.5` installer requires Windows x64 and Microsoft Edge WebView2. The installer is unsigned and Windows may show a publisher warning. This manual-download beta has a separate app profile and no automatic updates. Keep backups of important artwork. [Releases](https://github.com/Supah9889/seaglass-studio-releases/releases)

## Build from source

Use Node.js 24 with npm, Rust 1.90 or newer with the x64 MSVC toolchain, Microsoft C++ Build Tools with the Windows SDK, and WebView2. [Tauri prerequisites](https://tauri.app/start/prerequisites/)

```powershell
npm ci
npm run version:check
npm test
cargo test --manifest-path src-tauri/Cargo.toml --locked
npm run desktop:build
```

The last command builds the unsigned x64 installer, archives it under `target-private-beta/candidates`, and records its source commit and SHA-256. To work on the web frontend, run `npm run dev`. For the desktop development shell, run `npm run desktop:dev`.

## Feedback and licensing

Please include the app version, Windows version, and steps to reproduce when reporting a bug. Share a sample project only if you want it to be public. [Report a bug](https://github.com/Supah9889/seaglass-studio/issues)

See [contribution guidelines](CONTRIBUTING.md), [security reporting](SECURITY.md), and [attribution and licensing](ATTRIBUTION.md).
