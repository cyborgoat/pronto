# Pronto Product Spec

## Goal

Pronto is a lightweight desktop launcher inspired by Alfred and Listary. Its
primary job is to let users press a global shortcut, type a short query, and open
an app, file, or folder with minimal latency.

## Target Platforms

- macOS
- Windows
- Linux where Tauri global shortcuts and window behavior are supported

## Core User Flows

### Floating Launcher

1. User presses `CmdOrCtrl+Shift+P`.
2. A compact floating search bar appears above other windows.
3. Search input is focused immediately.
4. User types a query.
5. Results update using the Rust search index.
6. User presses Enter or clicks a result.
7. Pronto opens the selected item and hides the launcher.
8. Pressing Escape or moving focus away hides the launcher.

### Full Panel

1. User opens Pronto from the app icon.
2. The full panel appears.
3. User searches and applies filters.
4. User can reindex roots and inspect result metadata.
5. User can invoke the compact launcher from the full panel.

### System Tray

1. User starts Pronto.
2. Pronto creates a persistent system tray icon.
3. User clicks the tray icon to show or hide the full panel.
4. User opens the tray menu to show Pronto, open the launcher, or quit.

## Functional Requirements

- Register a system-level global shortcut from the Rust layer.
- Keep the app resident so the shortcut works when no Pronto window is focused.
- Use a separate native floating window for the compact launcher.
- Use a separate native main window for the full panel.
- Keep launcher borderless, always on top, hidden from the taskbar, and
  transparent where supported.
- Hide launcher on focus loss.
- Keep a persistent system tray/menu bar icon while the app is running.
- Provide tray menu actions for showing the full panel, opening the launcher,
  and quitting the app.
- Index apps, files, and folders from default roots.
- Support fuzzy search against names, extensions, and paths.
- Support filters in the full panel:
  - Result type
  - Extension list
  - Minimum size
  - Maximum size
  - Modified after
  - Modified before
  - Indexed roots
- Open selected results using the platform default handler.

## Non-Goals For Current Version

- Full content indexing inside documents.
- Real-time filesystem watching.
- User-editable settings persistence.
- Auto-start at login.
- Custom shortcut recorder UI.
- Plugin system or command palette actions beyond open/search.

## Current Defaults

- Shortcut: `CmdOrCtrl+Shift+P`
- Main window: `1120x760`
- Launcher window: `680x214`
- Result limit: `30`
- Launcher visible result cap: `7`

## Platform Notes

macOS transparent Tauri windows require `macos-private-api` and
`macOSPrivateApi`. This is acceptable for development and direct distribution,
but it may affect App Store submission.
