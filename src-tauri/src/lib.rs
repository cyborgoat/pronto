use chrono::{DateTime, NaiveDate, Utc};
use fuzzy_matcher::skim::SkimMatcherV2;
use fuzzy_matcher::FuzzyMatcher;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::SystemTime;
use tauri::Emitter;
use tauri::Manager;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use walkdir::{DirEntry, WalkDir};

const LAUNCHER_HOTKEY: &str = "CmdOrCtrl+Shift+P";

#[derive(Default)]
struct AppState {
    store: Mutex<SearchStore>,
}

#[derive(Default)]
struct SearchStore {
    items: Vec<IndexItem>,
    status: IndexStatus,
    last_opened: HashSet<String>,
}

#[derive(Clone)]
struct IndexItem {
    id: String,
    kind: SearchKind,
    name: String,
    path: String,
    extension: Option<String>,
    size_bytes: Option<u64>,
    modified_at: Option<String>,
    modified_secs: Option<i64>,
    haystack: String,
}

#[derive(Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum SearchKind {
    File,
    Folder,
    App,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchFilters {
    kinds: Vec<SearchKind>,
    extensions: Option<Vec<String>>,
    min_size_bytes: Option<u64>,
    max_size_bytes: Option<u64>,
    modified_after: Option<String>,
    modified_before: Option<String>,
    roots: Option<Vec<String>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SearchResult {
    id: String,
    kind: SearchKind,
    name: String,
    path: String,
    extension: Option<String>,
    size_bytes: Option<u64>,
    modified_at: Option<String>,
    score: i64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct IndexStatus {
    state: IndexState,
    indexed_count: usize,
    last_indexed_at: Option<String>,
    error: Option<String>,
}

impl Default for IndexStatus {
    fn default() -> Self {
        Self {
            state: IndexState::Idle,
            indexed_count: 0,
            last_indexed_at: None,
            error: None,
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "lowercase")]
enum IndexState {
    Idle,
    Indexing,
    Error,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Settings {
    hotkey: String,
    roots: Vec<String>,
    result_limit: usize,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            hotkey: LAUNCHER_HOTKEY.to_string(),
            roots: default_roots()
                .into_iter()
                .map(|path| path.to_string_lossy().to_string())
                .collect(),
            result_limit: 30,
        }
    }
}

#[tauri::command]
fn search(
    state: tauri::State<AppState>,
    query: String,
    filters: SearchFilters,
    limit: usize,
) -> Result<Vec<SearchResult>, String> {
    ensure_indexed(&state)?;

    let matcher = SkimMatcherV2::default();
    let normalized_query = query.trim().to_lowercase();
    let after = filters
        .modified_after
        .as_deref()
        .and_then(start_of_day_timestamp);
    let before = filters
        .modified_before
        .as_deref()
        .and_then(end_of_day_timestamp);
    let extensions = filters.extensions.as_ref().map(|values| {
        values
            .iter()
            .map(|value| value.trim_start_matches('.').to_lowercase())
            .filter(|value| !value.is_empty())
            .collect::<HashSet<_>>()
    });
    let roots = filters.roots.as_ref().map(|values| {
        values
            .iter()
            .map(|value| normalize_path_string(value))
            .collect::<Vec<_>>()
    });

    let store = state.store.lock().map_err(lock_error)?;
    let mut results = store
        .items
        .iter()
        .filter(|item| filters.kinds.is_empty() || filters.kinds.contains(&item.kind))
        .filter(|item| {
            roots
                .as_ref()
                .is_none_or(|roots| roots.iter().any(|root| item.path.starts_with(root)))
        })
        .filter(|item| {
            extensions.as_ref().is_none_or(|extensions| {
                item.kind == SearchKind::App
                    || item
                        .extension
                        .as_ref()
                        .is_some_and(|extension| extensions.contains(&extension.to_lowercase()))
            })
        })
        .filter(|item| {
            filters
                .min_size_bytes
                .is_none_or(|min| item.size_bytes.is_some_and(|size| size >= min))
        })
        .filter(|item| {
            filters
                .max_size_bytes
                .is_none_or(|max| item.size_bytes.is_some_and(|size| size <= max))
        })
        .filter(|item| after.is_none_or(|after| item.modified_secs.is_some_and(|ts| ts >= after)))
        .filter(|item| {
            before.is_none_or(|before| item.modified_secs.is_some_and(|ts| ts <= before))
        })
        .filter_map(|item| {
            let base_score = if normalized_query.is_empty() {
                0
            } else {
                matcher.fuzzy_match(&item.haystack, &normalized_query)?
            };
            let habit_bonus = if store.last_opened.contains(&item.id) {
                5_000
            } else {
                0
            };
            let kind_bonus = match item.kind {
                SearchKind::App => 1_500,
                SearchKind::Folder => 750,
                SearchKind::File => 0,
            };

            Some(SearchResult {
                id: item.id.clone(),
                kind: item.kind.clone(),
                name: item.name.clone(),
                path: item.path.clone(),
                extension: item.extension.clone(),
                size_bytes: item.size_bytes,
                modified_at: item.modified_at.clone(),
                score: base_score + habit_bonus + kind_bonus,
            })
        })
        .collect::<Vec<_>>();

    results.sort_by(|a, b| b.score.cmp(&a.score).then_with(|| a.name.cmp(&b.name)));
    results.truncate(limit.max(1));
    Ok(results)
}

#[tauri::command]
fn open_result(state: tauri::State<AppState>, id: String) -> Result<(), String> {
    let path = {
        let mut store = state.store.lock().map_err(lock_error)?;
        let path = store
            .items
            .iter()
            .find(|item| item.id == id)
            .map(|item| item.path.clone())
            .ok_or_else(|| "Result no longer exists in the index".to_string())?;
        store.last_opened.insert(id);
        path
    };

    open::that_detached(path).map_err(|error| error.to_string())
}

#[tauri::command]
fn reindex(
    state: tauri::State<AppState>,
    roots: Option<Vec<String>>,
) -> Result<IndexStatus, String> {
    {
        let mut store = state.store.lock().map_err(lock_error)?;
        store.status = IndexStatus {
            state: IndexState::Indexing,
            indexed_count: store.items.len(),
            last_indexed_at: store.status.last_indexed_at.clone(),
            error: None,
        };
    }

    let scan_roots = roots
        .unwrap_or_default()
        .into_iter()
        .map(PathBuf::from)
        .filter(|path| path.exists())
        .collect::<Vec<_>>();
    let scan_roots = if scan_roots.is_empty() {
        default_roots()
    } else {
        scan_roots
    };

    match build_index(&scan_roots) {
        Ok(items) => {
            let status = IndexStatus {
                state: IndexState::Idle,
                indexed_count: items.len(),
                last_indexed_at: Some(Utc::now().to_rfc3339()),
                error: None,
            };
            let mut store = state.store.lock().map_err(lock_error)?;
            store.items = items;
            store.status = status.clone();
            Ok(status)
        }
        Err(error) => {
            let status = IndexStatus {
                state: IndexState::Error,
                indexed_count: 0,
                last_indexed_at: None,
                error: Some(error.clone()),
            };
            let mut store = state.store.lock().map_err(lock_error)?;
            store.status = status.clone();
            Err(error)
        }
    }
}

#[tauri::command]
fn get_index_status(state: tauri::State<AppState>) -> Result<IndexStatus, String> {
    let store = state.store.lock().map_err(lock_error)?;
    Ok(store.status.clone())
}

#[tauri::command]
fn get_settings() -> Settings {
    Settings::default()
}

#[tauri::command]
fn update_settings(settings: Settings) -> Settings {
    Settings {
        hotkey: if settings.hotkey.trim().is_empty() {
            LAUNCHER_HOTKEY.to_string()
        } else {
            settings.hotkey
        },
        roots: if settings.roots.is_empty() {
            Settings::default().roots
        } else {
            settings.roots
        },
        result_limit: settings.result_limit.clamp(10, 100),
    }
}

#[tauri::command]
fn show_launcher_window(app: tauri::AppHandle) -> Result<(), String> {
    show_launcher(&app)
}

#[tauri::command]
fn hide_launcher_window(app: tauri::AppHandle) -> Result<(), String> {
    let Some(window) = app.get_webview_window("launcher") else {
        return Ok(());
    };

    window.hide().map_err(|error| error.to_string())
}

#[tauri::command]
fn show_main_window(app: tauri::AppHandle) -> Result<(), String> {
    show_main(&app)
}

fn ensure_indexed(state: &tauri::State<AppState>) -> Result<(), String> {
    let needs_index = {
        let store = state.store.lock().map_err(lock_error)?;
        store.items.is_empty()
    };

    if needs_index {
        let _ = reindex(state.clone(), None)?;
    }

    Ok(())
}

fn build_index(roots: &[PathBuf]) -> Result<Vec<IndexItem>, String> {
    let mut items = Vec::new();
    let mut seen = HashSet::new();

    for root in roots {
        if root.is_dir() {
            for entry in WalkDir::new(root)
                .max_depth(scan_depth(root))
                .into_iter()
                .filter_entry(should_descend)
                .filter_map(Result::ok)
            {
                if let Some(item) = index_entry(entry.path()) {
                    if seen.insert(item.id.clone()) {
                        items.push(item);
                    }
                }
            }
        } else if let Some(item) = index_entry(root) {
            if seen.insert(item.id.clone()) {
                items.push(item);
            }
        }
    }

    Ok(items)
}

fn index_entry(path: &Path) -> Option<IndexItem> {
    let metadata = fs::metadata(path).ok()?;
    let is_dir = metadata.is_dir();
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_lowercase());
    let kind = if extension.as_deref() == Some("app") && is_dir {
        SearchKind::App
    } else if is_dir {
        SearchKind::Folder
    } else {
        SearchKind::File
    };

    let name = if kind == SearchKind::App {
        app_display_name(path).unwrap_or_else(|| {
            path.file_stem()
                .and_then(|value| value.to_str())
                .unwrap_or_default()
                .to_string()
        })
    } else {
        path.file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_string()
    };

    if name.is_empty() {
        return None;
    }

    let modified = metadata.modified().ok();
    let modified_secs = modified.and_then(system_time_secs);
    let modified_at = modified.map(system_time_rfc3339);
    let path_string = normalize_path_string(&path.to_string_lossy());
    let haystack = format!(
        "{} {} {}",
        name.to_lowercase(),
        extension.clone().unwrap_or_default(),
        path_string.to_lowercase()
    );

    Some(IndexItem {
        id: path_string.clone(),
        kind,
        name,
        path: path_string,
        extension,
        size_bytes: if is_dir { None } else { Some(metadata.len()) },
        modified_at,
        modified_secs,
        haystack,
    })
}

fn app_display_name(path: &Path) -> Option<String> {
    let plist_path = path.join("Contents").join("Info.plist");
    let plist = plist::Value::from_file(plist_path).ok()?;
    let dict = plist.as_dictionary()?;
    dict.get("CFBundleDisplayName")
        .or_else(|| dict.get("CFBundleName"))
        .and_then(|value| value.as_string())
        .map(ToString::to_string)
}

fn default_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();

    if cfg!(target_os = "macos") {
        roots.push(PathBuf::from("/Applications"));
        if let Some(home) = dirs::home_dir() {
            roots.push(home.join("Applications"));
            roots.push(home.join("Desktop"));
            roots.push(home.join("Documents"));
            roots.push(home.join("Downloads"));
        }
    } else if let Some(home) = dirs::home_dir() {
        roots.push(home.join("Desktop"));
        roots.push(home.join("Documents"));
        roots.push(home.join("Downloads"));
    }

    roots.into_iter().filter(|path| path.exists()).collect()
}

fn should_descend(entry: &DirEntry) -> bool {
    let name = entry.file_name().to_string_lossy();
    if name.starts_with('.') {
        return false;
    }

    !matches!(
        name.as_ref(),
        "Library"
            | "node_modules"
            | "target"
            | "dist"
            | "build"
            | "__pycache__"
            | "System"
            | "Volumes"
    )
}

fn scan_depth(root: &Path) -> usize {
    if root == Path::new("/Applications") {
        2
    } else {
        6
    }
}

fn normalize_path_string(path: &str) -> String {
    path.replace('\\', "/")
}

fn system_time_secs(time: SystemTime) -> Option<i64> {
    time.duration_since(SystemTime::UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_secs() as i64)
}

fn system_time_rfc3339(time: SystemTime) -> String {
    let datetime: DateTime<Utc> = time.into();
    datetime.to_rfc3339()
}

fn start_of_day_timestamp(value: &str) -> Option<i64> {
    NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .ok()?
        .and_hms_opt(0, 0, 0)?
        .and_utc()
        .timestamp()
        .into()
}

fn end_of_day_timestamp(value: &str) -> Option<i64> {
    NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .ok()?
        .and_hms_opt(23, 59, 59)?
        .and_utc()
        .timestamp()
        .into()
}

fn lock_error<T>(error: std::sync::PoisonError<T>) -> String {
    format!("Search index lock failed: {error}")
}

fn show_launcher(app: &tauri::AppHandle) -> Result<(), String> {
    let Some(window) = app.get_webview_window("launcher") else {
        return Err("Launcher window is not available".to_string());
    };

    window.center().map_err(|error| error.to_string())?;
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    window
        .emit("pronto-focus-search", ())
        .map_err(|error| error.to_string())
}

fn show_main(app: &tauri::AppHandle) -> Result<(), String> {
    let Some(window) = app.get_webview_window("main") else {
        return Err("Main window is not available".to_string());
    };

    if let Some(launcher) = app.get_webview_window("launcher") {
        let _ = launcher.hide();
    }

    window.show().map_err(|error| error.to_string())?;
    window.center().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    window
        .emit("pronto-focus-search", ())
        .map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .manage(AppState::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            search,
            open_result,
            reindex,
            get_index_status,
            get_settings,
            update_settings,
            show_launcher_window,
            hide_launcher_window,
            show_main_window
        ])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_title("Pronto");
            }
            if let Some(window) = app.get_webview_window("launcher") {
                let _ = window.set_title("Pronto Launcher");
            }
            if let Err(error) = app.global_shortcut().on_shortcut(
                LAUNCHER_HOTKEY,
                |app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        let _ = show_launcher(app);
                    }
                },
            ) {
                eprintln!("failed to register {LAUNCHER_HOTKEY}: {error}");
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Pronto");

    app.run(|app_handle, event| match event {
        tauri::RunEvent::Ready => {
            let _ = show_main(app_handle);
        }
        tauri::RunEvent::WindowEvent {
            event: tauri::WindowEvent::CloseRequested { api, .. },
            label,
            ..
        } if label == "main" => {
            api.prevent_close();
            if let Some(window) = app_handle.get_webview_window("main") {
                let _ = window.hide();
            }
        }
        tauri::RunEvent::WindowEvent {
            event: tauri::WindowEvent::Focused(false),
            label,
            ..
        } if label == "launcher" => {
            if let Some(window) = app_handle.get_webview_window("launcher") {
                let _ = window.hide();
            }
        }
        #[cfg(target_os = "macos")]
        tauri::RunEvent::Reopen { .. } => {
            let _ = show_main(app_handle);
        }
        _ => {}
    });
}
