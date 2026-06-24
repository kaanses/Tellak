import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useToast } from "../../shared/store/toastStore";
import { useI18n } from "../../shared/i18n";

// ── Interfaces ────────────────────────────────────────────────────────────────

interface LargeFileEntry { name: string; path: string; size: number; size_human: string; ext: string }
interface TreeEntry      { path: string; name: string; size: number; size_human: string; depth: number }
interface TreeDone       { timed_out: boolean; total: number };

// ── Constants ─────────────────────────────────────────────────────────────────

const card = {
    background: "rgba(245,237,214,0.04)",
    border: "1px solid rgba(245,237,214,0.1)",
} as const;

const TYPE_GROUPS: Record<string, string[]> = {
    video:    ["mp4", "mov", "avi", "mkv", "m4v", "wmv", "flv", "webm", "mpg", "mpeg", "m2ts", "ts"],
    audio:    ["mp3", "wav", "flac", "aac", "m4a", "ogg", "wma", "opus", "aiff"],
    archive:  ["zip", "tar", "gz", "rar", "7z", "bz2", "xz", "tgz", "tbz2", "zst"],
    disk:     ["dmg", "iso", "img", "vmdk", "vhd", "vdi", "sparseimage"],
    document: ["pdf", "doc", "docx", "ppt", "pptx", "xls", "xlsx", "pages", "numbers", "keynote"],
};
const TYPE_LABEL_KEYS: Record<string, string> = {
    all: "analyzer.typeAll", video: "analyzer.typeVideo", audio: "analyzer.typeAudio",
    archive: "analyzer.typeArchive", disk: "analyzer.typeDisk", document: "analyzer.typeDocument", other: "analyzer.typeOther",
};
const MIN_SIZES = [50, 100, 250, 500, 1024];

const JUNK_PATTERNS: Record<string, { badge: string; color: string; tip: string }> = {
    "node_modules":      { badge: "NPM",         color: "rgba(245,237,214,0.7)",  tip: "Yeniden kurmak için: npm install" },
    ".npm":              { badge: "npm cache",   color: "rgba(245,237,214,0.7)",  tip: "npm indirme önbelleği" },
    "DerivedData":       { badge: "Xcode",       color: "rgba(245,237,214,0.5)",  tip: "Xcode derleme dosyaları — silmesi güvenli" },
    "Archives":          { badge: "Xcode",       color: "rgba(245,237,214,0.5)",  tip: "Xcode uygulama arşivleri" },
    "iOS DeviceSupport": { badge: "Xcode",       color: "rgba(245,237,214,0.5)",  tip: "Eski iOS cihaz destek dosyaları" },
    "Pods":              { badge: "CocoaPods",   color: "#F5EDD6",                tip: "Yeniden kurmak için: pod install" },
    ".gradle":           { badge: "Gradle",      color: "rgba(245,237,214,0.4)",  tip: "Gradle derleme önbelleği" },
    "__pycache__":       { badge: "Python",      color: "rgba(245,237,214,0.5)",  tip: "Python bayt kodu önbelleği" },
    ".next":             { badge: "Next.js",     color: "#F5EDD6",                tip: "Next.js derleme çıktısı" },
    ".nuxt":             { badge: "Nuxt",        color: "rgba(245,237,214,0.4)",  tip: "Nuxt derleme önbelleği" },
    "dist":              { badge: "Build",       color: "rgba(255,255,255,0.35)", tip: "Derleme çıktı klasörü" },
    "build":             { badge: "Build",       color: "rgba(255,255,255,0.35)", tip: "Derleme çıktı klasörü" },
    ".cache":            { badge: "analyzer.badgeCache",    color: "#F5EDD6",                tip: "Genel uygulama önbelleği" },
    "Caches":            { badge: "analyzer.badgeCache",    color: "#F5EDD6",                tip: "Uygulama önbellek verileri" },
    "Logs":              { badge: "analyzer.badgeLogs",   color: "rgba(255,255,255,0.3)",  tip: "Günlük dosyaları" },
    "DiagnosticReports": { badge: "Crash",       color: "rgba(255,255,255,0.3)",  tip: "Uygulama çökme raporları" },
    "vendor":            { badge: "Vendor",      color: "rgba(245,237,214,0.7)",  tip: "Üçüncü taraf bağımlılıkları" },
    ".yarn":             { badge: "Yarn",        color: "rgba(245,237,214,0.5)",  tip: "Yarn paket önbelleği" },
    "pnpm-store":        { badge: "pnpm",        color: "rgba(245,237,214,0.7)",  tip: "pnpm paket deposu" },
    "Simulator":         { badge: "Simulator",   color: "rgba(245,237,214,0.5)",  tip: "iOS Simülatör verileri" },
    "CoreSimulator":     { badge: "Simulator",   color: "rgba(245,237,214,0.5)",  tip: "iOS Simülatör önbelleği" },
    ".Trash":            { badge: "analyzer.badgeTrash",         color: "rgba(200,80,80,0.8)",    tip: "Silinmeyi bekleyen dosyalar" },
    "target":            { badge: "Rust build",  color: "#f97316",                tip: "Rust/Cargo derleme dosyaları" },
    ".cargo":            { badge: "Cargo",       color: "#f97316",                tip: "Rust kayıt defteri ve derleme önbelleği" },
    "Homebrew":          { badge: "Homebrew",    color: "rgba(245,237,214,0.7)",  tip: "Homebrew paket önbelleği" },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

export function humanize(b: number) {
    if (b === 0) return "0 B";
    const u = ["B","KB","MB","GB","TB"]; let i = 0, s = b;
    while (s >= 1024 && i < u.length - 1) { s /= 1024; i++; }
    return i === 0 ? `${b} B` : `${s.toFixed(1)} ${u[i]}`;
}

export function shortPath(path: string, home: string) {
    if (path === home) return "~";
    if (path.startsWith(home + "/")) return "~" + path.slice(home.length);
    return path;
}

function getJunkInfo(name: string) { return JUNK_PATTERNS[name] ?? null; }

export function getFileType(ext: string): string {
    for (const [type, exts] of Object.entries(TYPE_GROUPS)) {
        if (exts.includes(ext.toLowerCase())) return type;
    }
    return "other";
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function FolderIcon({ dim = false }: { dim?: boolean }) {
    return (
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
            <path d="M1 5.5C1 4.67 1.67 4 2.5 4H6l1.5 2H13.5C14.33 6 15 6.67 15 7.5V12.5C15 13.33 14.33 14 13.5 14H2.5C1.67 14 1 13.33 1 12.5V5.5Z"
                fill={dim ? "rgba(255,255,255,0.12)" : "#F5EDD6"} opacity={dim ? 1 : 0.85} />
        </svg>
    );
}

function TrashIcon() {
    return (
        <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} style={{ flexShrink: 0 }}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
    );
}

function Spinner({ size = 12 }: { size?: number }) {
    const w = size <= 12 ? 1.5 : 2;
    return <span style={{ width: size, height: size, border: `${w}px solid rgba(245,237,214,0.2)`, borderTopColor: "rgba(245,237,214,0.85)", borderRadius: "50%", display: "inline-block", flexShrink: 0, animation: "spin 0.7s linear infinite" }} />;
}

function FileTypeIcon({ ext }: { ext: string }) {
    const { t } = useI18n();
    const type = getFileType(ext);
    const colors: Record<string, string> = {
        video:    "#F5EDD6",
        audio:    "rgba(245,237,214,0.7)",
        archive:  "rgba(245,237,214,0.7)",
        disk:     "rgba(245,237,214,0.55)",
        document: "rgba(245,237,214,0.55)",
        other:    "rgba(255,255,255,0.25)",
    };
    const color = colors[type] ?? colors.other;
    return (
        <div style={{ width: 34, height: 34, borderRadius: 9, background: `${color}18`, border: `1px solid ${color}30`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <span style={{ fontSize: 8, fontWeight: 800, color, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                {ext ? ext.slice(0, 4) : t("analyzer.fileExtFallback")}
            </span>
        </div>
    );
}

// ── Shared modal ──────────────────────────────────────────────────────────────

function ConfirmModal({ title, body, confirmLabel, onConfirm, onCancel, danger = false }: {
    title: string; body: string; confirmLabel: string;
    onConfirm: () => void; onCancel: () => void; danger?: boolean;
}) {
    const { t } = useI18n();
    return createPortal(
        <div style={{ position: "fixed", inset: 0, zIndex: 99999, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ borderRadius: 18, padding: "22px 26px", width: 360, maxWidth: "90vw", background: "#1a0e00", border: `1px solid ${danger ? "rgba(200,80,80,0.3)" : "rgba(245,237,214,0.2)"}`, display: "flex", flexDirection: "column", gap: 14 }}>
                <div>
                    <p style={{ margin: "0 0 6px", fontSize: 15, fontWeight: 700, color: "#F5EDD6" }}>{title}</p>
                    <p style={{ margin: 0, fontSize: 12, color: "rgba(245,237,214,0.35)" }}>{body}</p>
                </div>
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                    <button onClick={onCancel} style={{ padding: "7px 16px", fontSize: 13, color: "rgba(245,237,214,0.45)", background: "transparent", border: "1px solid rgba(245,237,214,0.16)", borderRadius: 99, cursor: "pointer" }}>
                        {t("analyzer.cancel")}
                    </button>
                    <button onClick={onConfirm} style={{ padding: "7px 18px", fontSize: 13, fontWeight: 600, color: danger ? "#F5EDD6" : "#150b00", background: danger ? "rgba(200,80,80,0.25)" : "#F5EDD6", border: `1px solid ${danger ? "rgba(200,80,80,0.5)" : "rgba(245,237,214,0.45)"}`, borderRadius: 99, cursor: "pointer" }}>
                        {confirmLabel}
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
}

// ── Large Files view ──────────────────────────────────────────────────────────

function LargeFileRow({ file, home, onTrash }: { file: LargeFileEntry; home: string; onTrash: () => void }) {
    const [hovered, setHovered] = useState(false);
    const lastSlash = file.path.lastIndexOf("/");
    const dirPath   = lastSlash > 0 ? file.path.slice(0, lastSlash) : file.path;

    return (
        <div
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderBottom: "1px solid rgba(245,237,214,0.06)", background: hovered ? "rgba(245,237,214,0.03)" : "transparent", transition: "background 0.1s" }}
        >
            <FileTypeIcon ext={file.ext} />
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: "rgba(245,237,214,0.82)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.name}</div>
                <div style={{ fontSize: 10, color: "rgba(245,237,214,0.25)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 2 }}>{shortPath(dirPath, home)}</div>
            </div>
            <span style={{ fontSize: 12, fontFamily: "monospace", fontWeight: 700, color: "rgba(245,237,214,0.85)", flexShrink: 0 }}>{file.size_human}</span>
            <button
                onClick={onTrash}
                style={{
                    display: "flex", alignItems: "center", justifyContent: "center",
                    width: 28, height: 28, borderRadius: 7,
                    background: "rgba(200,80,80,0.1)", border: "1px solid rgba(200,80,80,0.25)",
                    color: "rgba(220,100,100,0.9)", cursor: "pointer", flexShrink: 0,
                    opacity: hovered ? 1 : 0, pointerEvents: hovered ? "auto" : "none",
                    transition: "opacity 0.15s, background 0.12s",
                }}
                onMouseEnter={e => { e.currentTarget.style.background = "rgba(200,80,80,0.22)"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "rgba(200,80,80,0.1)"; }}
            >
                <TrashIcon />
            </button>
        </div>
    );
}

function LargeFilesView({ home }: { home: string }) {
    const toast = useToast();
    const { t } = useI18n();
    const [files,       setFiles]      = useState<LargeFileEntry[]>([]);
    const [scanning,    setScanning]   = useState(false);
    const [minMb,       setMinMb]      = useState(50);
    const [typeFilter,  setTypeFilter] = useState("all");
    const [hasScanned,  setHasScanned] = useState(false);
    const [trashTarget, setTrashTarget] = useState<LargeFileEntry | null>(null);

    const scan = async () => {
        setScanning(true); setFiles([]);
        try {
            const result = await invoke<LargeFileEntry[]>("find_large_files", { root: home, minMb });
            setFiles(result); setHasScanned(true);
        } catch (e) { toast.error(String(e)); }
        setScanning(false);
    };

    const doTrash = async () => {
        if (!trashTarget) return;
        const target = trashTarget; setTrashTarget(null);
        try {
            await invoke("trash_duplicate_file", { path: target.path });
            setFiles(prev => prev.filter(f => f.path !== target.path));
            toast.success(t("analyzer.movedToTrash", { name: target.name }));
        } catch (e) { toast.error(String(e)); }
    };

    const filtered = typeFilter === "all"
        ? files
        : files.filter(f => getFileType(f.ext) === typeFilter);

    const totalFiltered = filtered.reduce((s, f) => s + f.size, 0);

    const typeOptions = ["all", "video", "audio", "archive", "disk", "document", "other"].filter(t => {
        if (t === "all") return true;
        return files.some(f => getFileType(f.ext) === t);
    });

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

            {/* Controls bar */}
            <div style={{ ...card, borderRadius: 14, padding: "12px 16px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span style={{ fontSize: 11, color: "rgba(245,237,214,0.25)", flexShrink: 0 }}>{t("analyzer.minSize")}</span>
                <div style={{ display: "flex", gap: 4 }}>
                    {MIN_SIZES.map(mb => (
                        <button key={mb} onClick={() => setMinMb(mb)} style={{
                            padding: "4px 10px", fontSize: 11, fontWeight: 600, borderRadius: 99, cursor: "pointer", transition: "all 0.15s",
                            color: minMb === mb ? "#F5EDD6" : "rgba(245,237,214,0.32)",
                            background: minMb === mb ? "rgba(245,237,214,0.16)" : "rgba(245,237,214,0.03)",
                            border: `1px solid ${minMb === mb ? "rgba(245,237,214,0.35)" : "rgba(245,237,214,0.08)"}`,
                        }}>
                            {mb >= 1024 ? `${mb / 1024} GB` : `${mb} MB`}
                        </button>
                    ))}
                </div>
                <div style={{ flex: 1 }} />
                <button onClick={scan} disabled={scanning} style={{
                    padding: "7px 20px", fontSize: 12, fontWeight: 700, borderRadius: 99, cursor: scanning ? "not-allowed" : "pointer",
                    display: "flex", alignItems: "center", gap: 8, transition: "all 0.15s",
                    color: scanning ? "rgba(245,237,214,0.3)" : "#150b00",
                    background: scanning ? "rgba(245,237,214,0.07)" : "#F5EDD6",
                    border: "1px solid rgba(245,237,214,0.45)",
                }}
                    onMouseEnter={e => { if (!scanning) { e.currentTarget.style.background = "rgba(245,237,214,0.82)"; } }}
                    onMouseLeave={e => { e.currentTarget.style.background = scanning ? "rgba(245,237,214,0.07)" : "#F5EDD6"; }}
                >
                    {scanning && <Spinner size={11} />}
                    {scanning ? t("analyzer.scanning") : hasScanned ? t("analyzer.rescan") : t("analyzer.scanNow")}
                </button>
            </div>

            {/* Scanning placeholder */}
            {scanning && (
                <div style={{ ...card, borderRadius: 14, padding: "44px 16px", display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
                    <Spinner size={20} />
                    <p style={{ margin: 0, fontSize: 12, color: "rgba(245,237,214,0.3)" }}>
                        {t("analyzer.searchingFilesAbove", { size: minMb >= 1024 ? `${minMb / 1024} GB` : `${minMb} MB` })}
                    </p>
                </div>
            )}

            {/* Empty state */}
            {!hasScanned && !scanning && (
                <div style={{ ...card, borderRadius: 14, padding: "52px 16px", textAlign: "center" }}>
                    <p style={{ margin: "0 0 8px", fontSize: 18, fontWeight: 700, color: "rgba(245,237,214,0.45)", fontFamily: "'New York', 'Iowan Old Style', Georgia, serif" }}>{t("analyzer.largeEmptyTitle")}</p>
                    <p style={{ margin: 0, fontSize: 12, color: "rgba(245,237,214,0.2)" }}>
                        {t("analyzer.largeEmptyBody", { size: minMb >= 1024 ? `${minMb / 1024} GB` : `${minMb} MB` })}
                    </p>
                </div>
            )}

            {/* Results */}
            {hasScanned && !scanning && (
                <>
                    {/* Type filters + summary */}
                    <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                        {typeOptions.map(ty => {
                            const count = ty === "all" ? files.length : files.filter(f => getFileType(f.ext) === ty).length;
                            return (
                                <button key={ty} onClick={() => setTypeFilter(ty)} style={{
                                    padding: "3px 10px", fontSize: 11, fontWeight: 600, borderRadius: 99, cursor: "pointer", transition: "all 0.15s",
                                    color: typeFilter === ty ? "#F5EDD6" : "rgba(245,237,214,0.32)",
                                    background: typeFilter === ty ? "rgba(245,237,214,0.14)" : "transparent",
                                    border: `1px solid ${typeFilter === ty ? "rgba(245,237,214,0.32)" : "rgba(245,237,214,0.1)"}`,
                                }}>
                                    {TYPE_LABEL_KEYS[ty] ? t(TYPE_LABEL_KEYS[ty]) : ty} · {count}
                                </button>
                            );
                        })}
                        <span style={{ marginLeft: "auto", fontSize: 11, color: "rgba(245,237,214,0.22)", fontFamily: "monospace" }}>
                            {t("analyzer.fileCount", { count: filtered.length })} · {humanize(totalFiltered)}
                        </span>
                    </div>

                    {files.length === 0 ? (
                        <div style={{ ...card, borderRadius: 14, padding: "32px 16px", textAlign: "center" }}>
                            <p style={{ margin: 0, fontSize: 13, color: "rgba(245,237,214,0.3)" }}>
                                {t("analyzer.noFilesAbove", { size: minMb >= 1024 ? `${minMb / 1024} GB` : `${minMb} MB` })}
                            </p>
                        </div>
                    ) : filtered.length === 0 ? (
                        <div style={{ ...card, borderRadius: 14, padding: "24px 16px", textAlign: "center" }}>
                            <p style={{ margin: 0, fontSize: 12, color: "rgba(245,237,214,0.3)" }}>{t("analyzer.noTypeInResults", { type: TYPE_LABEL_KEYS[typeFilter] ? t(TYPE_LABEL_KEYS[typeFilter]) : typeFilter })}</p>
                        </div>
                    ) : (
                        <div style={{ ...card, borderRadius: 14, overflow: "hidden" }}>
                            {filtered.map(file => (
                                <LargeFileRow key={file.path} file={file} home={home} onTrash={() => setTrashTarget(file)} />
                            ))}
                        </div>
                    )}
                </>
            )}

            {trashTarget && (
                <ConfirmModal
                    title={t("analyzer.moveToTrashTitle")}
                    body={`${trashTarget.name} · ${trashTarget.size_human}`}
                    confirmLabel={t("analyzer.moveToTrash")}
                    onConfirm={doTrash}
                    onCancel={() => setTrashTarget(null)}
                />
            )}
        </div>
    );
}


// ── Folder Tree view ──────────────────────────────────────────────────────────

const TREE_MIN_SIZES = [10, 50, 100, 500, 1024];

function TreeEntryRow({ entry, pct, relPath, onDelete }: {
    entry: TreeEntry; pct: number; relPath: string; onDelete: () => void;
}) {
    const { t } = useI18n();
    const [hovered, setHovered] = useState(false);
    const junk = getJunkInfo(entry.name);
    const parts = relPath.split("/");
    const lastName = parts[parts.length - 1];
    const parentPath = parts.length > 1 ? parts.slice(0, -1).join("/") + "/" : "";

    return (
        <div
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", borderBottom: "1px solid rgba(245,237,214,0.06)", background: hovered ? "rgba(245,237,214,0.03)" : "transparent", transition: "background 0.1s" }}
        >
            <FolderIcon dim={entry.size === 0} />
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                    <span style={{ fontSize: 10, color: "rgba(245,237,214,0.28)", flexShrink: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{parentPath}</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: "rgba(245,237,214,0.82)", whiteSpace: "nowrap", flexShrink: 0 }}>{lastName}</span>
                    {junk && <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.06em", flexShrink: 0, color: junk.color, background: `${junk.color}18`, border: `1px solid ${junk.color}40`, padding: "1px 5px", borderRadius: 4 }}>{junk.badge.startsWith("analyzer.") ? t(junk.badge) : junk.badge}</span>}
                    <span style={{ marginLeft: "auto", fontSize: 11, fontFamily: "monospace", flexShrink: 0, color: "rgba(245,237,214,0.85)" }}>{entry.size_human}</span>
                </div>
                <div style={{ width: "100%", background: "rgba(245,237,214,0.08)", borderRadius: 99, height: 3 }}>
                    <div style={{ height: 3, borderRadius: 99, width: `${pct}%`, background: junk ? junk.color : "rgba(245,237,214,0.85)", transition: "width 0.4s ease" }} />
                </div>
            </div>
            <div style={{ width: 28, height: 28, flexShrink: 0 }}>
                <button
                    onClick={e => { e.stopPropagation(); onDelete(); }}
                    style={{ width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 7, background: "rgba(200,80,80,0.1)", border: "1px solid rgba(200,80,80,0.25)", color: "rgba(220,100,100,0.9)", cursor: "pointer", opacity: hovered ? 1 : 0, pointerEvents: hovered ? "auto" : "none", transition: "opacity 0.15s, background 0.12s" }}
                    onMouseEnter={e => { e.currentTarget.style.background = "rgba(200,80,80,0.22)"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "rgba(200,80,80,0.1)"; }}
                >
                    <TrashIcon />
                </button>
            </div>
        </div>
    );
}

function FolderTreeView({ home }: { home: string }) {
    const toast = useToast();
    const { t } = useI18n();
    const [entries,      setEntries]      = useState<TreeEntry[]>([]);
    const [scanning,     setScanning]     = useState(false);
    const [scanRoot,     setScanRoot]     = useState<string | null>(null);
    const [done,         setDone]         = useState(false);
    const [timedOut,     setTimedOut]     = useState(false);
    const [minMb,        setMinMb]        = useState(50);
    const [deleteTarget, setDeleteTarget] = useState<TreeEntry | null>(null);
    const entriesRef  = useRef<TreeEntry[]>([]);
    const unlistenRef = useRef<(() => void) | null>(null);

    useEffect(() => () => { unlistenRef.current?.(); }, []);

    const startScan = useCallback(async (path: string) => {
        unlistenRef.current?.();
        setScanRoot(path);
        setEntries([]);
        setScanning(true);
        setDone(false);
        setTimedOut(false);
        entriesRef.current = [];

        const ul1 = await listen<{ entries: TreeEntry[] }>("tree_entries", e => {
            entriesRef.current = [...entriesRef.current, ...e.payload.entries];
            setEntries([...entriesRef.current]);
        });

        const ul2 = await listen<TreeDone>("tree_done", e => {
            const sorted = [...entriesRef.current].sort((a, b) => b.size - a.size);
            setEntries(sorted);
            setScanning(false);
            setDone(true);
            setTimedOut(e.payload.timed_out);
            ul1(); ul2();
            unlistenRef.current = null;
        });

        unlistenRef.current = () => { ul1(); ul2(); };

        try {
            await invoke("scan_folder_tree", { path });
        } catch (e) {
            toast.error(String(e));
            setScanning(false);
            ul1(); ul2();
            unlistenRef.current = null;
        }
    }, [toast]);

    const doDelete = useCallback(async () => {
        if (!deleteTarget) return;
        const target = deleteTarget;
        setDeleteTarget(null);
        try {
            await invoke("clean_junk_paths", { paths: [target.path] });
            setEntries(prev => prev.filter(e => !e.path.startsWith(target.path)));
            toast.success(t("analyzer.deleted", { name: target.name }));
        } catch (e) { toast.error(String(e)); }
    }, [deleteTarget, toast, t]);

    const minBytes = minMb * 1024 * 1024;
    const filtered = entries.filter(e => e.size >= minBytes);
    const maxSize  = filtered[0]?.size ?? 1;

    const PRESETS = home ? [
        { label: t("analyzer.presetHome"),         path: home },
        { label: t("analyzer.presetDownloads"),    path: `${home}/Downloads` },
        { label: t("analyzer.presetDocuments"),    path: `${home}/Documents` },
        { label: t("analyzer.presetDeveloper"),    path: `${home}/Developer` },
        { label: t("analyzer.presetLibrary"),      path: `${home}/Library` },
        { label: t("analyzer.presetApplications"), path: "/Applications" },
    ] : [];

    const shortRelPath = (path: string) => {
        if (!scanRoot) return path;
        return path.startsWith(scanRoot + "/") ? path.slice(scanRoot.length + 1) : path;
    };

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

            {/* Preset chips + status */}
            <div style={{ ...card, borderRadius: 14, padding: "12px 16px", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                {PRESETS.map(p => (
                    <button key={p.path} onClick={() => startScan(p.path)} disabled={scanning}
                        style={{
                            padding: "5px 13px", fontSize: 11, fontWeight: 600, borderRadius: 99,
                            cursor: scanning ? "not-allowed" : "pointer", transition: "all 0.15s",
                            color: scanRoot === p.path ? "#F5EDD6" : "rgba(245,237,214,0.4)",
                            background: scanRoot === p.path ? "rgba(245,237,214,0.16)" : "rgba(245,237,214,0.03)",
                            border: `1px solid ${scanRoot === p.path ? "rgba(245,237,214,0.35)" : "rgba(245,237,214,0.08)"}`,
                        }}>
                        {p.label}
                    </button>
                ))}
                <div style={{ flex: 1 }} />
                {scanning && (
                    <span style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11, color: "rgba(245,237,214,0.32)" }}>
                        <Spinner size={12} /> {t("analyzer.foldersFound", { count: entries.length })}
                    </span>
                )}
                {done && !scanning && (
                    <button onClick={() => scanRoot && startScan(scanRoot)}
                        style={{ padding: "4px 12px", fontSize: 11, fontWeight: 500, color: "rgba(245,237,214,0.4)", background: "rgba(245,237,214,0.04)", border: "1px solid rgba(245,237,214,0.12)", borderRadius: 99, cursor: "pointer" }}>
                        {t("analyzer.rescan")}
                    </button>
                )}
            </div>

            {/* Min-size filter */}
            {(scanning || done) && (
                <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                    <span style={{ fontSize: 11, color: "rgba(245,237,214,0.25)", marginRight: 2 }}>{t("analyzer.minSize")}</span>
                    {TREE_MIN_SIZES.map(mb => (
                        <button key={mb} onClick={() => setMinMb(mb)}
                            style={{
                                padding: "3px 10px", fontSize: 11, fontWeight: 600, borderRadius: 99, cursor: "pointer", transition: "all 0.15s",
                                color: minMb === mb ? "#F5EDD6" : "rgba(245,237,214,0.32)",
                                background: minMb === mb ? "rgba(245,237,214,0.16)" : "transparent",
                                border: `1px solid ${minMb === mb ? "rgba(245,237,214,0.35)" : "rgba(245,237,214,0.1)"}`,
                            }}>
                            {mb >= 1024 ? `${mb / 1024} GB` : `${mb} MB`}
                        </button>
                    ))}
                    {done && (
                        <span style={{ marginLeft: "auto", fontSize: 11, color: "rgba(245,237,214,0.22)", fontFamily: "monospace" }}>
                            {t("analyzer.folderCount", { count: filtered.length })}{timedOut ? t("analyzer.scanTruncated") : ""}
                        </span>
                    )}
                </div>
            )}

            {/* Empty state */}
            {!scanning && !done && (
                <div style={{ ...card, borderRadius: 14, padding: "52px 16px", textAlign: "center" }}>
                    <p style={{ margin: "0 0 8px", fontSize: 18, fontWeight: 700, color: "rgba(245,237,214,0.45)", fontFamily: "'New York', 'Iowan Old Style', Georgia, serif" }}>{t("analyzer.treeEmptyTitle")}</p>
                    <p style={{ margin: 0, fontSize: 12, color: "rgba(245,237,214,0.2)" }}>
                        {t("analyzer.treeEmptyBody")}
                    </p>
                </div>
            )}

            {/* Scanning placeholder (before first results) */}
            {scanning && entries.length === 0 && (
                <div style={{ ...card, borderRadius: 14, padding: "44px 16px", display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
                    <Spinner size={20} />
                    <p style={{ margin: 0, fontSize: 12, color: "rgba(245,237,214,0.3)" }}>{t("analyzer.scanningFolders")}</p>
                </div>
            )}

            {/* Results list */}
            {filtered.length > 0 && (
                <div style={{ ...card, borderRadius: 14, overflow: "hidden" }}>
                    {filtered.slice(0, 300).map(entry => (
                        <TreeEntryRow
                            key={entry.path}
                            entry={entry}
                            pct={maxSize > 0 ? (entry.size / maxSize) * 100 : 0}
                            relPath={shortRelPath(entry.path)}
                            onDelete={() => setDeleteTarget(entry)}
                        />
                    ))}
                    {filtered.length > 300 && (
                        <p style={{ padding: "12px 16px", margin: 0, fontSize: 11, color: "rgba(245,237,214,0.25)", textAlign: "center" }}>
                            {t("analyzer.showingFirst300", { count: filtered.length })}
                        </p>
                    )}
                </div>
            )}

            {deleteTarget && (
                <ConfirmModal
                    title={t("analyzer.deleteTitle", { name: deleteTarget.name })}
                    body={t("analyzer.deleteBody", { size: deleteTarget.size_human })}
                    confirmLabel={t("analyzer.delete")}
                    danger
                    onConfirm={doDelete}
                    onCancel={() => setDeleteTarget(null)}
                />
            )}
        </div>
    );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AnalyzerPage() {
    const { t } = useI18n();
    const [mode, setMode] = useState<"large" | "tree">("large");
    const [home, setHome] = useState("");

    useEffect(() => {
        invoke<string>("get_home_path").then(setHome);
    }, []);

    return (
        <div className="fade-in" style={{ padding: "24px 28px", display: "flex", flexDirection: "column", gap: 16 }}>

            {/* Page title */}
            <div>
                <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, color: "#F5EDD6", fontFamily: "'New York', 'Iowan Old Style', Georgia, serif", letterSpacing: "-0.02em" }}>{t("analyzer.pageTitle")}</h1>
            </div>

            {/* ── Mode toggle ───────────────────────────────────────────────── */}
            <div style={{ display: "flex", gap: 3, padding: "3px", background: "rgba(245,237,214,0.04)", border: "1px solid rgba(245,237,214,0.1)", borderRadius: 12, alignSelf: "flex-start" }}>
                {(["large", "tree"] as const).map(m => (
                    <button key={m} onClick={() => setMode(m)} style={{
                        padding: "5px 16px", fontSize: 12, fontWeight: 600, borderRadius: 9, border: "none", cursor: "pointer", transition: "all 0.15s",
                        color: mode === m ? "#F5EDD6" : "rgba(245,237,214,0.32)",
                        background: mode === m ? "rgba(245,237,214,0.16)" : "transparent",
                    }}>
                        {m === "large" ? t("analyzer.modeLargeFiles") : t("analyzer.modeFolderTree")}
                    </button>
                ))}
            </div>

            {mode === "large" && <LargeFilesView home={home} />}
            {mode === "tree"  && <FolderTreeView  home={home} />}

            <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
        </div>
    );
}
