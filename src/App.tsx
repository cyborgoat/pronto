import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  AlertCircle,
  AppWindow,
  CalendarClock,
  CheckCircle2,
  Database,
  File,
  Folder,
  HardDrive,
  Keyboard,
  Loader2,
  Maximize2,
  RefreshCw,
  Search,
  Settings2,
  SlidersHorizontal,
} from "lucide-react";
import type * as React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type SearchKind = "file" | "folder" | "app";
type MainView = "search" | "settings";

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

const kindLabel = {
  app: "Apps",
  file: "Files",
  folder: "Folders",
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
  const [activeView, setActiveView] = useState<MainView>("search");
  const [extensionInput, setExtensionInput] = useState("");
  const [rootInput, setRootInput] = useState("");
  const [resultLimitInput, setResultLimitInput] = useState("30");
  const [settingsNotice, setSettingsNotice] = useState<string | null>(null);
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

  const showMain = useCallback(async () => {
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

  const reindex = useCallback(
    async (roots = settings.roots) => {
      const next = await invoke<IndexStatus>("reindex", { roots });
      setStatus(next);
      await runSearch();
      return next;
    },
    [runSearch, settings.roots],
  );

  const applySettings = useCallback(async () => {
    const roots = parseRootInput(rootInput);
    const requestedLimit = Number(resultLimitInput);
    const nextSettings = await invoke<Settings>("update_settings", {
      settings: {
        ...settings,
        roots,
        resultLimit: Number.isFinite(requestedLimit)
          ? requestedLimit
          : settings.resultLimit,
      },
    });

    setSettings(nextSettings);
    setResultLimitInput(String(nextSettings.resultLimit));
    setRootInput(nextSettings.roots.join("\n"));
    setFilters((current) => ({ ...current, roots: nextSettings.roots }));
    setSettingsNotice("Settings applied for this session.");
  }, [resultLimitInput, rootInput, settings]);

  const applySettingsAndReindex = useCallback(async () => {
    await applySettings();
    const roots = parseRootInput(rootInput);
    const scanRoots = roots.length ? roots : settings.roots;
    await reindex(scanRoots);
    setSettingsNotice("Index refreshed with the current roots.");
  }, [applySettings, reindex, rootInput, settings.roots]);

  useEffect(() => {
    async function bootstrap() {
      const nextSettings = await invoke<Settings>("get_settings");
      setSettings(nextSettings);
      setRootInput(nextSettings.roots.join("\n"));
      setResultLimitInput(String(nextSettings.resultLimit));
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
      } else {
        setActiveView("search");
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
        if (isLauncherWindow) {
          void showMain();
        } else {
          setActiveView("settings");
        }
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isLauncherWindow, openResult, results.length, showMain]);

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
        isLauncherWindow
          ? "bg-transparent p-2"
          : "min-h-screen bg-[oklch(0.965_0.006_264)]",
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
          showMain={showMain}
          compactResultLimit={LAUNCHER_VISIBLE_RESULTS}
        />
      ) : (
        <MainPanel
          activeView={activeView}
          setActiveView={setActiveView}
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
          searchRef={searchRef}
          rootInput={rootInput}
          setRootInput={setRootInput}
          resultLimitInput={resultLimitInput}
          setResultLimitInput={setResultLimitInput}
          settingsNotice={settingsNotice}
          applySettings={applySettings}
          applySettingsAndReindex={applySettingsAndReindex}
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
  showMain,
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
  showMain: () => Promise<void>;
  compactResultLimit: number;
}) {
  const visibleResults = results.slice(0, compactResultLimit);

  return (
    <BorderGlow className="h-full w-full">
      <section className="flex h-full w-full flex-col overflow-hidden rounded-xl bg-[oklch(0.985_0.004_264)] shadow-[0_24px_70px_rgba(24,24,27,0.22)]">
        <div className="grid grid-cols-[24px_1fr_36px] items-center gap-3 px-4 py-3">
          <Search className="h-5 w-5 text-zinc-500" />
          <Input
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search apps, files, and folders"
            className="h-10 border-0 bg-transparent px-0 text-[15px] shadow-none focus-visible:ring-0"
          />
          <Button
            aria-label="Open full panel"
            variant="ghost"
            size="icon"
            onClick={() => void showMain()}
          >
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
        <div className="flex items-center justify-between px-4 py-2 text-xs text-zinc-500">
          <span>{status.indexedCount.toLocaleString()} indexed items</span>
          <span>{shortcutStatus}</span>
        </div>
      </section>
    </BorderGlow>
  );
}

function BorderGlow({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("pronto-border-glow", className)}>
      <div className="pronto-border-glow__content">{children}</div>
    </div>
  );
}

function MainPanel({
  activeView,
  setActiveView,
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
  searchRef,
  rootInput,
  setRootInput,
  resultLimitInput,
  setResultLimitInput,
  settingsNotice,
  applySettings,
  applySettingsAndReindex,
}: {
  activeView: MainView;
  setActiveView: (value: MainView) => void;
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
  searchRef: React.RefObject<HTMLInputElement | null>;
  rootInput: string;
  setRootInput: (value: string) => void;
  resultLimitInput: string;
  setResultLimitInput: (value: string) => void;
  settingsNotice: string | null;
  applySettings: () => Promise<void>;
  applySettingsAndReindex: () => Promise<void>;
}) {
  return (
    <div className="grid h-screen min-h-0 grid-cols-[236px_1fr]">
      <aside className="flex min-h-0 flex-col border-r border-zinc-200/80 bg-[oklch(0.985_0.004_264)] px-3 py-4">
        <div className="mb-6 flex items-center gap-3 px-2">
          <img alt="Pronto" className="h-8 w-8 rounded-lg" src="/pronto-logo.svg" />
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold text-zinc-950">Pronto</h1>
            <p className="truncate text-xs text-zinc-500">Fast local launcher</p>
          </div>
        </div>

        <nav className="space-y-1">
          <NavButton
            active={activeView === "search"}
            icon={Search}
            label="Search"
            onClick={() => {
              setActiveView("search");
              requestAnimationFrame(() => searchRef.current?.focus());
            }}
          />
          <NavButton
            active={activeView === "settings"}
            icon={Settings2}
            label="Settings"
            onClick={() => setActiveView("settings")}
          />
        </nav>

        <div className="mt-auto space-y-3 px-2">
          <div className="rounded-lg bg-zinc-100/80 px-3 py-2 text-xs text-zinc-600">
            <div className="mb-1 flex items-center gap-2 font-medium text-zinc-800">
              <Keyboard className="h-3.5 w-3.5" />
              {settings.hotkey}
            </div>
            <p>Opens the floating launcher.</p>
          </div>
          <Button className="w-full" variant="outline" onClick={() => void showLauncher()}>
            <Maximize2 className="h-4 w-4" />
            Open launcher
          </Button>
        </div>
      </aside>

      {activeView === "search" ? (
        <SearchView
          query={query}
          setQuery={setQuery}
          results={results}
          selectedIndex={selectedIndex}
          setSelectedIndex={setSelectedIndex}
          openResult={openResult}
          status={status}
          filters={filters}
          setFilters={setFilters}
          extensionInput={extensionInput}
          setExtensionInput={setExtensionInput}
          searchRef={searchRef}
        />
      ) : (
        <SettingsView
          status={status}
          settings={settings}
          shortcutStatus={shortcutStatus}
          rootInput={rootInput}
          setRootInput={setRootInput}
          resultLimitInput={resultLimitInput}
          setResultLimitInput={setResultLimitInput}
          settingsNotice={settingsNotice}
          applySettings={applySettings}
          applySettingsAndReindex={applySettingsAndReindex}
        />
      )}
    </div>
  );
}

function NavButton({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ElementType;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        "flex h-9 w-full items-center gap-2 rounded-md px-3 text-left text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500",
        active && "bg-zinc-950 text-white hover:bg-zinc-950 hover:text-white",
      )}
      onClick={onClick}
      type="button"
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}

function SearchView({
  query,
  setQuery,
  results,
  selectedIndex,
  setSelectedIndex,
  openResult,
  status,
  filters,
  setFilters,
  extensionInput,
  setExtensionInput,
  searchRef,
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
  extensionInput: string;
  setExtensionInput: (value: string) => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <section className="flex min-w-0 flex-col">
      <header className="border-b border-zinc-200/80 bg-[oklch(0.985_0.004_264)] px-8 py-6">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold tracking-normal text-zinc-950">
              Search
            </h2>
            <p className="mt-1 text-sm text-zinc-500">
              Find apps, folders, and files from your indexed roots.
            </p>
          </div>
          <StatusPill status={status} />
        </div>

        <div className="grid grid-cols-[1fr_auto] items-center gap-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <Input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search apps, files, and folders"
              className="h-11 rounded-lg bg-white pl-9 text-[15px] shadow-sm"
            />
          </div>
          <Badge className="h-9 bg-white px-3">{results.length} results</Badge>
        </div>

        <FilterBar
          filters={filters}
          setFilters={setFilters}
          extensionInput={extensionInput}
          setExtensionInput={setExtensionInput}
        />
      </header>

      <ResultList
        results={results}
        selectedIndex={selectedIndex}
        setSelectedIndex={setSelectedIndex}
        openResult={openResult}
      />
    </section>
  );
}

function FilterBar({
  filters,
  setFilters,
  extensionInput,
  setExtensionInput,
}: {
  filters: SearchFilters;
  setFilters: React.Dispatch<React.SetStateAction<SearchFilters>>;
  extensionInput: string;
  setExtensionInput: (value: string) => void;
}) {
  return (
    <div className="mt-5 grid grid-cols-1 gap-3 min-[1080px]:grid-cols-[minmax(240px,1.15fr)_minmax(180px,0.85fr)_minmax(220px,1fr)_minmax(260px,1.2fr)]">
      <FilterGroup label="Type" icon={SlidersHorizontal}>
        <FilterKinds filters={filters} setFilters={setFilters} />
      </FilterGroup>

      <FilterGroup label="Extensions" icon={File}>
        <Input
          value={extensionInput}
          onChange={(event) => setExtensionInput(event.target.value)}
          placeholder="pdf, png, ts"
          className="h-9 bg-white shadow-none"
        />
      </FilterGroup>

      <FilterGroup label="Size" icon={HardDrive}>
        <SizeFilters setFilters={setFilters} />
      </FilterGroup>

      <FilterGroup label="Modified" icon={CalendarClock}>
        <DateFilters filters={filters} setFilters={setFilters} />
      </FilterGroup>
    </div>
  );
}

function FilterGroup({
  label,
  icon: Icon,
  children,
}: {
  label: string;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <label className="mb-2 flex items-center gap-1.5 text-xs font-medium text-zinc-500">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </label>
      {children}
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
  const options: SearchKind[] = ["app", "folder", "file"];

  return (
    <div className="grid h-9 grid-cols-3 rounded-md border border-zinc-200 bg-white p-1 shadow-sm">
      {options.map((kind) => {
        const active = filters.kinds.includes(kind);
        return (
          <button
            className={cn(
              "rounded text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100",
              active && "bg-zinc-950 text-white hover:bg-zinc-950",
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
            {kindLabel[kind]}
          </button>
        );
      })}
    </div>
  );
}

function SizeFilters({
  setFilters,
}: {
  setFilters: React.Dispatch<React.SetStateAction<SearchFilters>>;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <Input
        min={0}
        placeholder="Min MB"
        type="number"
        className="h-9 bg-white shadow-none"
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
        className="h-9 bg-white shadow-none"
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
    <div className="grid grid-cols-2 gap-2">
      <Input
        value={filters.modifiedAfter ?? ""}
        type="date"
        className="h-9 bg-white shadow-none"
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
        className="h-9 bg-white shadow-none"
        onChange={(event) =>
          setFilters((current) => ({
            ...current,
            modifiedBefore: event.target.value || undefined,
          }))
        }
      />
    </div>
  );
}

function SettingsView({
  status,
  settings,
  shortcutStatus,
  rootInput,
  setRootInput,
  resultLimitInput,
  setResultLimitInput,
  settingsNotice,
  applySettings,
  applySettingsAndReindex,
}: {
  status: IndexStatus;
  settings: Settings;
  shortcutStatus: string;
  rootInput: string;
  setRootInput: (value: string) => void;
  resultLimitInput: string;
  setResultLimitInput: (value: string) => void;
  settingsNotice: string | null;
  applySettings: () => Promise<void>;
  applySettingsAndReindex: () => Promise<void>;
}) {
  return (
    <section className="min-w-0 overflow-auto">
      <div className="mx-auto max-w-4xl px-8 py-7">
        <div className="mb-7">
          <h2 className="text-xl font-semibold text-zinc-950">Settings</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Tune indexing and launcher behavior without crowding search.
          </p>
        </div>

        <div className="divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-200 bg-[oklch(0.985_0.004_264)] shadow-sm">
          <SettingsSection
            icon={Database}
            title="Index"
            description="Refresh the local search index when roots change or results feel stale."
          >
            <div className="grid gap-4 min-[1180px]:grid-cols-3">
              <Metric label="Items" value={status.indexedCount.toLocaleString()} />
              <Metric label="State" value={status.state} />
              <Metric
                label="Last indexed"
                value={
                  status.lastIndexedAt
                    ? new Date(status.lastIndexedAt).toLocaleString()
                    : "Not indexed"
                }
              />
            </div>
            {status.error ? (
              <div className="mt-4 flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                <AlertCircle className="h-4 w-4" />
                {status.error}
              </div>
            ) : null}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button
                onClick={() => void applySettingsAndReindex()}
                disabled={status.state === "indexing"}
              >
                {status.state === "indexing" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                Reindex now
              </Button>
              <Button variant="outline" onClick={() => void applySettings()}>
                Apply settings
              </Button>
              {settingsNotice ? (
                <span className="flex items-center gap-1.5 text-sm text-zinc-500">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  {settingsNotice}
                </span>
              ) : null}
            </div>
          </SettingsSection>

          <SettingsSection
            icon={Folder}
            title="Indexed roots"
            description="One directory per line. These roots are used by search and the next reindex."
          >
            <textarea
              value={rootInput}
              onChange={(event) => setRootInput(event.target.value)}
              className="min-h-32 w-full resize-y rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm shadow-sm outline-none transition-colors placeholder:text-zinc-400 focus-visible:ring-2 focus-visible:ring-zinc-500"
              placeholder={"/Applications\n/Users/you/Documents"}
            />
            <p className="mt-2 text-xs text-zinc-500">
              Current session has {settings.roots.length} configured roots.
            </p>
          </SettingsSection>

          <SettingsSection
            icon={SlidersHorizontal}
            title="Search behavior"
            description="Keep result density predictable for both the main panel and launcher."
          >
            <div className="max-w-xs">
              <label className="mb-2 block text-xs font-medium text-zinc-500">
                Result limit
              </label>
              <Input
                min={10}
                max={100}
                value={resultLimitInput}
                type="number"
                onChange={(event) => setResultLimitInput(event.target.value)}
              />
              <p className="mt-2 text-xs text-zinc-500">
                Values are clamped between 10 and 100 by the native layer.
              </p>
            </div>
          </SettingsSection>

          <SettingsSection
            icon={Keyboard}
            title="Launcher"
            description="The compact launcher stays separate from the full panel."
          >
            <div className="grid gap-3 min-[1000px]:grid-cols-2">
              <Metric label="Hotkey" value={settings.hotkey} />
              <Metric label="Shortcut state" value={shortcutStatus} />
            </div>
          </SettingsSection>
        </div>
      </div>
    </section>
  );
}

function SettingsSection({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-5 px-5 py-5 min-[1100px]:grid-cols-[220px_1fr]">
      <div>
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-zinc-900">
          <Icon className="h-4 w-4 text-zinc-500" />
          {title}
        </div>
        <p className="text-sm leading-5 text-zinc-500">{description}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white px-3 py-2 shadow-sm ring-1 ring-zinc-200">
      <div className="text-xs font-medium text-zinc-500">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold text-zinc-900">{value}</div>
    </div>
  );
}

function StatusPill({ status }: { status: IndexStatus }) {
  if (status.state === "indexing") {
    return (
      <Badge className="gap-1.5 bg-amber-50 text-amber-800">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Indexing
      </Badge>
    );
  }

  if (status.state === "error") {
    return (
      <Badge className="gap-1.5 bg-red-50 text-red-700">
        <AlertCircle className="h-3.5 w-3.5" />
        Index error
      </Badge>
    );
  }

  return (
    <Badge className="gap-1.5 bg-emerald-50 text-emerald-700">
      <CheckCircle2 className="h-3.5 w-3.5" />
      Ready
    </Badge>
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
      <div
        className={cn(
          "flex flex-1 items-center justify-center p-10 text-sm text-zinc-500",
          compact && "p-6",
        )}
      >
        <Settings2 className="mr-2 h-4 w-4" />
        No matching indexed items yet.
      </div>
    );
  }

  return (
    <div
      className={cn(
        "min-h-0 flex-1 overflow-auto px-5 py-4",
        compact && "max-h-[118px] px-2 py-0",
      )}
    >
      {results.map((result, index) => {
        const Icon = kindIcon[result.kind];
        return (
          <button
            className={cn(
              "grid w-full grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-white",
              index === selectedIndex && "bg-white shadow-sm ring-1 ring-zinc-200",
              compact &&
                "grid-cols-[32px_minmax(0,1fr)_auto] rounded-md px-2 py-1.5 hover:bg-zinc-50",
              compact && index === selectedIndex && "bg-zinc-50 shadow-none ring-0",
            )}
            key={result.id}
            onClick={() => void openResult(result)}
            onMouseEnter={() => setSelectedIndex(index)}
            type="button"
          >
            <span
              className={cn(
                "flex h-9 w-9 items-center justify-center rounded-lg bg-zinc-100 text-zinc-600",
                compact && "h-8 w-8 rounded-md",
              )}
            >
              <Icon className="h-4 w-4" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-zinc-900">
                {result.name}
              </span>
              <span className="block truncate text-xs text-zinc-500">{result.path}</span>
            </span>
            <span className="flex items-center gap-2">
              {!compact ? <Badge>{result.kind}</Badge> : null}
              {result.sizeBytes ? <Badge>{formatBytes(result.sizeBytes)}</Badge> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function parseRootInput(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
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
