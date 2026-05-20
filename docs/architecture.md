# Pronto Architecture

## Stack

- Desktop shell: Tauri 2
- Backend: Rust
- Frontend: React 19 and Vite
- Runtime/package manager: Bun
- Styling: Tailwind CSS
- UI primitives: shadcn-style local components
- Icons: lucide-react

## Native Window Model

Pronto uses two Tauri windows instead of one mode-switched window.

### `main`

The main window is the full search and filter panel. It is opened on app startup
and macOS dock/app-icon reopen events.

Responsibilities:

- Render the full panel.
- Provide advanced filters.
- Trigger reindexing.
- Display status and indexed roots.

### `launcher`

The launcher window is the floating search bar. It starts hidden and is shown by
the Rust global shortcut handler.

Window properties:

- Borderless
- Always on top
- Hidden from taskbar
- Non-resizable
- Transparent window surface
- Auto-hidden on focus loss

Responsibilities:

- Render compact search input and result list.
- Focus input when shown.
- Open selected result on Enter.
- Hide on Escape, focus loss, or after opening a result.

## Shortcut Handling

Global shortcut registration belongs in Rust, not React.

Reasoning:

- The shortcut must work when webviews are hidden or unfocused.
- The shortcut should be owned by the resident process.
- Registration errors should be visible in the native app log.

Current shortcut:

```text
CmdOrCtrl+Shift+P
```

This maps to `Command+Shift+P` on macOS and `Ctrl+Shift+P` on Windows/Linux.

## Backend Commands

Commands exposed to the frontend:

- `search`
- `open_result`
- `reindex`
- `get_index_status`
- `get_settings`
- `update_settings`
- `show_launcher_window`
- `hide_launcher_window`
- `show_main_window`

## Search Index

The Rust backend builds an in-memory index of filesystem items.

Indexed fields:

- ID/path
- Kind: app, file, folder
- Name
- Extension
- Size
- Modified time
- Lowercased haystack for fuzzy matching

Default macOS roots:

- `/Applications`
- `~/Applications`
- `~/Desktop`
- `~/Documents`
- `~/Downloads`

Ranking combines fuzzy score with bonuses for apps, folders, and recently opened
items.

## Event Flow

Launcher invocation:

1. Tauri global shortcut plugin receives `CmdOrCtrl+Shift+P`.
2. Rust handler calls `show_launcher`.
3. Launcher window is centered, shown, focused, and emits `pronto-focus-search`.
4. React focuses the search input.

App icon reopen:

1. Tauri receives `RunEvent::Reopen` on macOS.
2. Rust calls `show_main`.
3. Main window is shown and focused.
4. Launcher is hidden if it is open.

Launcher close:

1. Launcher loses focus or receives Escape.
2. Rust hides the launcher window.
