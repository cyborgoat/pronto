import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  AppWindow,
  CalendarClock,
  File,
  Folder,
  Loader2,
  Maximize2,
  Play,
  RefreshCw,
  Search,
  Settings2,
} from "lucide-react";
import type * as React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type SearchKind = "file" | "folder" | "app";

type SearchFilters = {
  kinds: SearchKind[];
  extensions?: string[];
  minSizeBytes?: number;
  maxSizeBytes?: number;
  modifiedAfter?: string;
  modifiedBefore?: string;
  roots?: string[];
};

type SearchResult = {
  id: string;
  kind: SearchKind;
  name: string;
  path: string;
  extension?: string;
  sizeBytes?: number;
  modifiedAt?: string;
  score: number;
};

type IndexStatus = {
  state: "idle" | "indexing" | "error";
  indexedCount: number;
  lastIndexedAt?: string;
  error?: string;
};

type Settings = {
  hotkey: string;
  roots: string[];
  resultLimit: number;
};

const defaultFilters: SearchFilters = {
  kinds: ["file", "folder", "app"],
};

const LAUNCHER_VISIBLE_RESULTS = 7;

const kindIcon = {
  app: AppWindow,
  file: File,
  folder: Folder,
};

function App() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [status, setStatus] = useState<IndexStatus>({
    state: "idle",
    indexedCount: 0,
  });
  const [settings, setSettings] = useState<Settings>({
    hotkey: "CmdOrCtrl+Shift+P",
    roots: [],
    resultLimit: 30,
  });
  const [filters, setFilters] = useState<SearchFilters>(defaultFilters);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [extensionInput, setExtensionInput] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const currentWindow = getCurrentWindow();
  const isLauncherWindow = currentWindow.label === "launcher";
  const shortcutStatus = `${settings.hotkey} registered`;

  const refreshStatus = useCallback(async () => {
    setStatus(await invoke<IndexStatus>("get_index_status"));
  }, []);

  const runSearch = useCallback(async () => {
    const nextResults = await invoke<SearchResult[]>("search", {
      query,
      filters,
      limit: settings.resultLimit,
    });
    setResults(nextResults);
    setSelectedIndex(0);
    await refreshStatus();
  }, [filters, query, refreshStatus, settings.resultLimit]);

  const showLauncher = useCallback(async () => {
    await invoke("show_launcher_window");
  }, []);

  const showAdvanced = useCallback(async () => {
    await invoke("show_main_window");
  }, []);

  const openResult = useCallback(
    async (result = results[selectedIndex]) => {
      if (!result) {
        return;
      }
      await invoke("open_result", { id: result.id });
      if (isLauncherWindow) {
        await invoke("hide_launcher_window");
      }
      await runSearch();
    },
    [isLauncherWindow, results, runSearch, selectedIndex],
  );

  useEffect(() => {
    async function bootstrap() {
      const nextSettings = await invoke<Settings>("get_settings");
      setSettings(nextSettings);
      setFilters((current) => ({ ...current, roots: nextSettings.roots }));
      if (!isLauncherWindow) {
        await invoke<IndexStatus>("reindex", { roots: nextSettings.roots })
          .then(setStatus)
          .catch(refreshStatus);
      } else {
        await refreshStatus();
      }
    }

    void bootstrap();
  }, [isLauncherWindow, refreshStatus]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void runSearch();
    }, 120);

    return () => window.clearTimeout(timeout);
  }, [runSearch]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    void listen("pronto-focus-search", () => {
      if (isLauncherWindow) {
        setQuery("");
      }
      setSelectedIndex(0);
      requestAnimationFrame(() => searchRef.current?.focus());
    }).then((listener) => {
      unlisten = listener;
    });

    return () => {
      unlisten?.();
    };
  }, [isLauncherWindow]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const visibleCount = isLauncherWindow
        ? Math.min(results.length, LAUNCHER_VISIBLE_RESULTS)
        : results.length;

      if (event.key === "Escape" && isLauncherWindow) {
        void invoke("hide_launcher_window");
      }
      if (event.key === "Enter" && isLauncherWindow) {
        void openResult();
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedIndex((index) =>
          Math.min(index + 1, Math.max(0, visibleCount - 1)),
        );
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedIndex((index) => Math.max(index - 1, 0));
      }
      if (event.key === "," && event.metaKey) {
        event.preventDefault();
        void showAdvanced();
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isLauncherWindow, openResult, results.length, showAdvanced]);

  const parsedExtensions = useMemo(
    () =>
      extensionInput
        .split(",")
        .map((value) => value.trim().replace(/^\./, ""))
        .filter(Boolean),
    [extensionInput],
  );

  useEffect(() => {
    setFilters((current) => ({
      ...current,
      extensions: parsedExtensions.length ? parsedExtensions : undefined,
    }));
  }, [parsedExtensions]);

  return (
    <main
      className={cn(
        "h-full text-zinc-950",
        isLauncherWindow ? "bg-transparent p-2" : "min-h-screen bg-zinc-100",
      )}
    >
      {isLauncherWindow ? (
        <LauncherView
          query={query}
          setQuery={setQuery}
          results={results}
          selectedIndex={selectedIndex}
          setSelectedIndex={setSelectedIndex}
          openResult={openResult}
          searchRef={searchRef}
          status={status}
          shortcutStatus={shortcutStatus}
          showAdvanced={showAdvanced}
          compactResultLimit={LAUNCHER_VISIBLE_RESULTS}
        />
      ) : (
        <AdvancedView
          query={query}
          setQuery={setQuery}
          results={results}
          selectedIndex={selectedIndex}
          setSelectedIndex={setSelectedIndex}
          openResult={openResult}
          status={status}
          filters={filters}
          setFilters={setFilters}
          settings={settings}
          shortcutStatus={shortcutStatus}
          showLauncher={showLauncher}
          extensionInput={extensionInput}
          setExtensionInput={setExtensionInput}
          reindex={async () => {
            const next = await invoke<IndexStatus>("reindex", {
              roots: settings.roots,
            });
            setStatus(next);
            await runSearch();
          }}
        />
      )}
    </main>
  );
}

function LauncherView({
  query,
  setQuery,
  results,
  selectedIndex,
  setSelectedIndex,
  openResult,
  searchRef,
  status,
  shortcutStatus,
  showAdvanced,
  compactResultLimit,
}: {
  query: string;
  setQuery: (value: string) => void;
  results: SearchResult[];
  selectedIndex: number;
  setSelectedIndex: (value: number) => void;
  openResult: (result?: SearchResult) => Promise<void>;
  searchRef: React.RefObject<HTMLInputElement | null>;
  status: IndexStatus;
  shortcutStatus: string;
  showAdvanced: () => Promise<void>;
  compactResultLimit: number;
}) {
  const visibleResults = results.slice(0, compactResultLimit);

  return (
    <section className="h-full w-full overflow-hidden rounded-lg bg-white/95 shadow-2xl backdrop-blur">
      <div className="flex items-center gap-2 border-b border-zinc-100 px-3 py-2">
        <Search className="h-5 w-5 text-zinc-500" />
        <Input
          ref={searchRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search apps, files, and folders"
          className="h-9 border-0 px-0 text-sm focus-visible:ring-0"
        />
        <Button variant="ghost" size="icon" onClick={() => void showAdvanced()}>
          <Maximize2 className="h-4 w-4" />
        </Button>
      </div>
      <ResultList
        results={visibleResults}
        selectedIndex={selectedIndex}
        setSelectedIndex={setSelectedIndex}
        openResult={openResult}
        compact
      />
      <div className="flex items-center justify-between border-t border-zinc-100 px-3 py-1.5 text-xs text-zinc-500">
        <span>{status.indexedCount.toLocaleString()} indexed items</span>
        <span>{shortcutStatus}</span>
      </div>
    </section>
  );
}

function AdvancedView({
  query,
  setQuery,
  results,
  selectedIndex,
  setSelectedIndex,
  openResult,
  status,
  filters,
  setFilters,
  settings,
  shortcutStatus,
  showLauncher,
  extensionInput,
  setExtensionInput,
  reindex,
}: {
  query: string;
  setQuery: (value: string) => void;
  results: SearchResult[];
  selectedIndex: number;
  setSelectedIndex: (value: number) => void;
  openResult: (result?: SearchResult) => Promise<void>;
  status: IndexStatus;
  filters: SearchFilters;
  setFilters: React.Dispatch<React.SetStateAction<SearchFilters>>;
  settings: Settings;
  shortcutStatus: string;
  showLauncher: () => Promise<void>;
  extensionInput: string;
  setExtensionInput: (value: string) => void;
  reindex: () => Promise<void>;
}) {
  return (
    <div className="mx-auto grid h-screen max-w-7xl grid-cols-[280px_1fr] gap-0">
      <aside className="border-r border-zinc-200 bg-white p-4">
        <div className="mb-6 flex items-center gap-2">
          <img alt="Pronto" className="h-7 w-7 rounded-md" src="/pronto-logo.svg" />
          <div>
            <h1 className="text-base font-semibold">Pronto</h1>
            <p className="text-xs text-zinc-500">{settings.hotkey} launcher</p>
          </div>
        </div>

        <div className="space-y-5">
          <FilterKinds filters={filters} setFilters={setFilters} />
          <div>
            <label className="mb-2 block text-xs font-medium uppercase text-zinc-500">
              Extensions
            </label>
            <Input
              value={extensionInput}
              onChange={(event) => setExtensionInput(event.target.value)}
              placeholder="pdf, png, ts"
            />
          </div>
          <SizeFilters setFilters={setFilters} />
          <DateFilters filters={filters} setFilters={setFilters} />
          <div>
            <label className="mb-2 block text-xs font-medium uppercase text-zinc-500">
              Indexed roots
            </label>
            <div className="space-y-1 text-xs text-zinc-600">
              {settings.roots.map((root) => (
                <div className="truncate rounded border border-zinc-200 px-2 py-1" key={root}>
                  {root}
                </div>
              ))}
            </div>
          </div>
        </div>
      </aside>

      <section className="flex min-w-0 flex-col">
        <header className="border-b border-zinc-200 bg-white px-5 py-4">
          <div className="flex items-center gap-3">
            <Search className="h-5 w-5 text-zinc-500" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search apps, files, and folders"
              className="h-10 text-base"
            />
            <Button variant="outline" onClick={() => void reindex()}>
              {status.state === "indexing" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Reindex
            </Button>
            <Button onClick={() => void showLauncher()}>
              <Play className="h-4 w-4" />
              Launcher
            </Button>
          </div>
          <div className="mt-3 flex items-center gap-2 text-xs text-zinc-500">
            <Badge>{results.length} results</Badge>
            <Badge>{status.indexedCount.toLocaleString()} indexed</Badge>
            {status.lastIndexedAt ? (
              <span>Last indexed {new Date(status.lastIndexedAt).toLocaleString()}</span>
            ) : null}
            <span>{shortcutStatus}</span>
            {status.error ? <span className="text-red-600">{status.error}</span> : null}
          </div>
        </header>
        <ResultList
          results={results}
          selectedIndex={selectedIndex}
          setSelectedIndex={setSelectedIndex}
          openResult={openResult}
        />
      </section>
    </div>
  );
}

function FilterKinds({
  filters,
  setFilters,
}: {
  filters: SearchFilters;
  setFilters: React.Dispatch<React.SetStateAction<SearchFilters>>;
}) {
  const options: Array<{ kind: SearchKind; label: string }> = [
    { kind: "app", label: "Apps" },
    { kind: "folder", label: "Folders" },
    { kind: "file", label: "Files" },
  ];

  return (
    <div>
      <label className="mb-2 block text-xs font-medium uppercase text-zinc-500">
        Result types
      </label>
      <div className="grid grid-cols-3 rounded-md border border-zinc-200 p-1">
        {options.map(({ kind, label }) => {
          const active = filters.kinds.includes(kind);
          return (
            <button
              className={cn(
                "h-8 rounded text-xs font-medium text-zinc-600",
                active && "bg-zinc-950 text-white",
              )}
              key={kind}
              onClick={() =>
                setFilters((current) => {
                  const nextKinds = active
                    ? current.kinds.filter((value) => value !== kind)
                    : [...current.kinds, kind];
                  return { ...current, kinds: nextKinds };
                })
              }
              type="button"
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SizeFilters({
  setFilters,
}: {
  setFilters: React.Dispatch<React.SetStateAction<SearchFilters>>;
}) {
  return (
    <div>
      <label className="mb-2 block text-xs font-medium uppercase text-zinc-500">
        Size
      </label>
      <div className="grid grid-cols-2 gap-2">
        <Input
          min={0}
          placeholder="Min MB"
          type="number"
          onChange={(event) =>
            setFilters((current) => ({
              ...current,
              minSizeBytes: event.target.value
                ? Number(event.target.value) * 1024 * 1024
                : undefined,
            }))
          }
        />
        <Input
          min={0}
          placeholder="Max MB"
          type="number"
          onChange={(event) =>
            setFilters((current) => ({
              ...current,
              maxSizeBytes: event.target.value
                ? Number(event.target.value) * 1024 * 1024
                : undefined,
            }))
          }
        />
      </div>
    </div>
  );
}

function DateFilters({
  filters,
  setFilters,
}: {
  filters: SearchFilters;
  setFilters: React.Dispatch<React.SetStateAction<SearchFilters>>;
}) {
  return (
    <div>
      <label className="mb-2 flex items-center gap-2 text-xs font-medium uppercase text-zinc-500">
        <CalendarClock className="h-3.5 w-3.5" />
        Modified
      </label>
      <div className="grid grid-cols-1 gap-2">
        <Input
          value={filters.modifiedAfter ?? ""}
          type="date"
          onChange={(event) =>
            setFilters((current) => ({
              ...current,
              modifiedAfter: event.target.value || undefined,
            }))
          }
        />
        <Input
          value={filters.modifiedBefore ?? ""}
          type="date"
          onChange={(event) =>
            setFilters((current) => ({
              ...current,
              modifiedBefore: event.target.value || undefined,
            }))
          }
        />
      </div>
    </div>
  );
}

function ResultList({
  results,
  selectedIndex,
  setSelectedIndex,
  openResult,
  compact = false,
}: {
  results: SearchResult[];
  selectedIndex: number;
  setSelectedIndex: (value: number) => void;
  openResult: (result?: SearchResult) => Promise<void>;
  compact?: boolean;
}) {
  if (results.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-10 text-sm text-zinc-500">
        <Settings2 className="mr-2 h-4 w-4" />
        No matching indexed items yet.
      </div>
    );
  }

  return (
    <div className={cn("min-h-0 flex-1 overflow-auto", compact && "max-h-[136px]")}>
      {results.map((result, index) => {
        const Icon = kindIcon[result.kind];
        return (
          <button
            className={cn(
              "grid w-full grid-cols-[32px_1fr_auto] items-center gap-3 border-b border-zinc-100 px-3 py-2 text-left hover:bg-zinc-50",
              index === selectedIndex && "bg-zinc-100",
            )}
            key={result.id}
            onClick={() => void openResult(result)}
            onMouseEnter={() => setSelectedIndex(index)}
            type="button"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-zinc-100 text-zinc-600">
              <Icon className="h-4 w-4" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-zinc-900">
                {result.name}
              </span>
              <span className="block truncate text-xs text-zinc-500">{result.path}</span>
            </span>
            <span className="flex items-center gap-2">
              <Badge>{result.kind}</Badge>
              {result.sizeBytes ? <Badge>{formatBytes(result.sizeBytes)}</Badge> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

export default App;
