# Pronto Development Notes

## Prerequisites

- Bun
- Rust stable toolchain
- Tauri system dependencies for the target OS

## Install

```sh
bun install
```

## Run

```sh
bun run tauri dev
```

This starts Vite and the Tauri desktop app.

## Validate

```sh
bun run build
cd src-tauri && cargo check
```

## Important Files

- `src/App.tsx`: React UI for both native windows.
- `src/index.css`: global frontend styles.
- `src/components/ui`: local UI primitives.
- `src-tauri/src/lib.rs`: Rust commands, indexing, window control, shortcut
  handling, app lifecycle.
- `src-tauri/tauri.conf.json`: Tauri windows, build config, bundle config.
- `src-tauri/capabilities/default.json`: frontend permission scope for windows.

## Window Capability Scope

Both `main` and `launcher` must be listed in
`src-tauri/capabilities/default.json`. The launcher calls backend commands, so
omitting it from capabilities can make the floating UI appear broken even when
the window opens.

## macOS Transparent Launcher

The floating launcher uses a transparent Tauri window. On macOS this requires:

- `tauri = { features = ["macos-private-api"] }` in `src-tauri/Cargo.toml`
- `"macOSPrivateApi": true` in `src-tauri/tauri.conf.json`
- `"transparent": true` on the launcher window

This is useful for direct distribution and development. Review App Store rules
before shipping through the Mac App Store.

## Shortcut Debugging

The shortcut is registered in Rust with:

```text
CmdOrCtrl+Shift+P
```

If the launcher does not open:

1. Check the Tauri dev log for shortcut registration errors.
2. Confirm the app is still running in the background.
3. Check for shortcut conflicts with other apps.
4. On macOS, verify any required input/accessibility permissions if system
   policy blocks global keyboard monitoring.

## Documentation Updates

Update `docs/spec.md` when behavior changes. Update `docs/architecture.md` when
native window, command, shortcut, or indexing design changes.
