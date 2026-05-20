# Pronto

Pronto is a cross-platform desktop launcher for fast local search across apps,
files, and folders. It is built with Tauri 2, Rust, React, Vite, Bun, Tailwind,
and shadcn-style UI primitives.

The current app uses two native Tauri windows:

- `main`: the full search and filtering panel opened from the app icon.
- `launcher`: a compact, borderless, always-on-top floating search bar opened by
  the global shortcut.

The launcher shortcut is registered in Rust as `CmdOrCtrl+Shift+P`, which maps
to `Command+Shift+P` on macOS and `Ctrl+Shift+P` on Windows/Linux.

## Features

- Global shortcut invoked launcher window.
- Borderless floating search bar with auto-hide on focus loss.
- Full search panel with filters for result type, extension, size, modified date,
  and indexed roots.
- Local file/app/folder indexing in Rust.
- Fuzzy matching and ranked results.
- Open files, folders, and apps from search results.

## Documentation

- [Product spec](docs/spec.md)
- [Architecture](docs/architecture.md)
- [Development notes](docs/development.md)

## Brand Asset

The app logo is available at `public/pronto-logo.svg`. It is a simple italic
lowercase `p` mark with an Italian tricolor accent.

## Development

```sh
bun install
bun run tauri dev
```

## Checks

```sh
bun run build
cd src-tauri && cargo check
```

## macOS Notes

The launcher window uses transparency for the floating-panel effect. On macOS,
Tauri requires the `macos-private-api` feature and `macOSPrivateApi` config for
transparent windows, which can affect App Store eligibility.
