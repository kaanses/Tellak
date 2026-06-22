import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useToast } from "../../shared/store/toastStore";

export interface DuplicateFile {
    name: string;
    path: string;
    size_human: string;
    modified: number;
}

interface DuplicateGroup {
    size: number;
    size_human: string;
    wasted: number;
    wasted_human: string;
    files: DuplicateFile[];
}

interface DuplicateReport {
    groups: DuplicateGroup[];
    total_wasted: number;
    total_wasted_human: string;
    files_scanned: number;
}

interface DupProgress {
    phase: "walking" | "hashing" | "done";
    count: number;
    total: number;
    current: string;
}

interface MutableFile extends DuplicateFile { deleted: boolean; }
interface MutableGroup extends Omit<DuplicateGroup, "files"> { files: MutableFile[]; }

const card = {
    background: "rgba(245,237,214,0.04)",
    border: "1px solid rgba(245,237,214,0.1)",
} as const;

export type KeepStrategy = "newest" | "oldest" | "shallowest";

const DIR_OPTIONS = [
    { label: "İndirilenler", sub: "Downloads" },
    { label: "Belgeler",     sub: "Documents" },
    { label: "Masaüstü",     sub: "Desktop" },
    { label: "Resimler",     sub: "Pictures" },
    { label: "Filmler",      sub: "Movies" },
    { label: "Müzik",        sub: "Music" },
];

export function formatDate(unix: number) {
    if (!unix) return "";
    return new Date(unix * 1000).toLocaleDateString("tr-TR", {
        year: "numeric", month: "short", day: "numeric",
    });
}

export function formatBytes(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function pickKeeper(live: DuplicateFile[], strategy: KeepStrategy): string {
    if (live.length === 0) return "";
    const sorted = [...live].sort((a, b) => {
        if (strategy === "newest") {
            const d = b.modified - a.modified;
            return d !== 0 ? d : a.path.localeCompare(b.path);
        }
        if (strategy === "oldest") {
            const d = a.modified - b.modified;
            return d !== 0 ? d : b.path.localeCompare(a.path);
        }
        const depth = a.path.split("/").length - b.path.split("/").length;
        if (depth !== 0) return depth;
        const d = b.modified - a.modified;
        return d !== 0 ? d : a.path.localeCompare(b.path);
    });
    return sorted[0].path;
}

function StrategyPicker({ value, onChange }: { value: KeepStrategy; onChange: (s: KeepStrategy) => void }) {
    const opts: { key: KeepStrategy; label: string }[] = [
        { key: "newest",     label: "En Yeni" },
        { key: "oldest",     label: "En Eski" },
        { key: "shallowest", label: "En Sığ" },
    ];
    return (
        <div style={{ display: "flex", gap: 4 }}>
            {opts.map(o => (
                <button
                    key={o.key}
                    onClick={() => onChange(o.key)}
                    style={{
                        padding: "4px 10px", fontSize: 11, fontWeight: 600,
                        borderRadius: 99, cursor: "pointer", transition: "all 0.12s",
                        color:      value === o.key ? "#F5EDD6"               : "rgba(245,237,214,0.35)",
                        background: value === o.key ? "rgba(245,237,214,0.16)"  : "transparent",
                        border:     value === o.key ? "1px solid rgba(245,237,214,0.35)" : "1px solid rgba(245,237,214,0.1)",
                    }}
                >
                    {o.label}
                </button>
            ))}
        </div>
    );
}

function GroupCard({ group, strategy, onTrash }: {
    group: MutableGroup; strategy: KeepStrategy; onTrash: (path: string) => Promise<void>;
}) {
    const [open,     setOpen]     = useState(true);
    const [trashing, setTrashing] = useState<string | null>(null);
    const [keepBusy, setKeepBusy] = useState(false);

    const live = group.files.filter(f => !f.deleted);
    if (live.length < 2) return null;

    const keepPath = pickKeeper(live, strategy);

    const handleTrash = async (f: DuplicateFile) => {
        setTrashing(f.path);
        try { await onTrash(f.path); }
        finally { setTrashing(null); }
    };

    const handleKeepOne = async () => {
        setKeepBusy(true);
        for (const f of live) {
            if (f.path !== keepPath) await onTrash(f.path);
        }
        setKeepBusy(false);
    };

    return (
        <div style={{ ...card, borderRadius: 14, overflow: "hidden" }}>
            {/* Group header */}
            <button
                onClick={() => setOpen(o => !o)}
                style={{
                    width: "100%", background: "transparent", border: "none",
                    padding: "12px 16px", display: "flex", alignItems: "center",
                    gap: 12, cursor: "pointer", textAlign: "left",
                    transition: "background 0.15s",
                }}
                onMouseEnter={e => (e.currentTarget.style.background = "rgba(245,237,214,0.03)")}
                onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
            >
                <div style={{
                    width: 7, height: 7, borderRadius: 4, flexShrink: 0,
                    background: "#F5EDD6",
                }} />

                <div style={{ flex: 1, display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#F5EDD6" }}>
                        {live.length} kopya
                    </span>
                    <span style={{ fontSize: 12, color: "rgba(245,237,214,0.32)" }}>
                        her biri {group.size_human}
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: "rgba(245,237,214,0.7)", marginLeft: "auto" }}>
                        {formatBytes(group.wasted)} israf
                    </span>
                </div>

                <button
                    onClick={e => { e.stopPropagation(); handleKeepOne(); }}
                    disabled={keepBusy}
                    style={{
                        padding: "3px 10px", fontSize: 10, fontWeight: 600,
                        color: keepBusy ? "rgba(245,237,214,0.2)" : "rgba(245,237,214,0.7)",
                        background: "transparent",
                        border: `1px solid ${keepBusy ? "rgba(245,237,214,0.06)" : "rgba(245,237,214,0.28)"}`,
                        borderRadius: 99, cursor: keepBusy ? "not-allowed" : "pointer",
                        flexShrink: 0, transition: "all 0.12s",
                    }}
                    onMouseEnter={e => { if (!keepBusy) e.currentTarget.style.background = "rgba(245,237,214,0.1)"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
                >
                    {keepBusy ? "…" : "1 Tut"}
                </button>

                <svg width="13" height="13" fill="none" viewBox="0 0 24 24"
                    stroke="rgba(245,237,214,0.3)" strokeWidth={2}
                    style={{ flexShrink: 0, transition: "transform 0.2s", transform: open ? "rotate(180deg)" : "rotate(0deg)" }}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
            </button>

            {/* File rows */}
            {open && (
                <div style={{ borderTop: "1px solid rgba(245,237,214,0.08)" }}>
                    {group.files.map(file => {
                        if (file.deleted) return null;
                        const isKept = file.path === keepPath;
                        const busy   = trashing === file.path;
                        return (
                            <div
                                key={file.path}
                                style={{
                                    display: "flex", alignItems: "center", gap: 12,
                                    padding: "9px 16px",
                                    borderBottom: "1px solid rgba(245,237,214,0.06)",
                                    transition: "background 0.12s",
                                }}
                                onMouseEnter={e => ((e.currentTarget as HTMLElement).style.background = "rgba(245,237,214,0.025)")}
                                onMouseLeave={e => ((e.currentTarget as HTMLElement).style.background = "transparent")}
                            >
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                        <span style={{ fontSize: 12, fontWeight: 500, color: isKept ? "#F5EDD6" : "rgba(245,237,214,0.5)" }}>
                                            {file.name}
                                        </span>
                                        {isKept && (
                                            <span style={{
                                                fontSize: 9, fontWeight: 700,
                                                color: "#F5EDD6", background: "rgba(245,237,214,0.1)",
                                                border: "1px solid rgba(245,237,214,0.25)",
                                                padding: "1px 5px", borderRadius: 4,
                                                letterSpacing: "0.08em",
                                            }}>
                                                SAKLA
                                            </span>
                                        )}
                                    </div>
                                    <div style={{
                                        fontSize: 10, color: "rgba(245,237,214,0.22)",
                                        marginTop: 2, overflow: "hidden",
                                        textOverflow: "ellipsis", whiteSpace: "nowrap",
                                    }}>
                                        {file.path}
                                        {file.modified > 0 && (
                                            <span style={{ marginLeft: 8, color: "rgba(245,237,214,0.15)" }}>
                                                {formatDate(file.modified)}
                                            </span>
                                        )}
                                    </div>
                                </div>

                                <button
                                    onClick={() => handleTrash(file)}
                                    disabled={busy || isKept}
                                    title={isKept ? "Bu dosya saklanacak" : "Çöp kutusuna taşı"}
                                    style={{
                                        padding: "4px 12px", fontSize: 11,
                                        color: busy || isKept ? "rgba(245,237,214,0.18)" : "rgba(210,90,90,0.9)",
                                        background: "transparent",
                                        border: `1px solid ${busy || isKept ? "rgba(245,237,214,0.06)" : "rgba(200,80,80,0.28)"}`,
                                        borderRadius: 99,
                                        cursor: busy || isKept ? "not-allowed" : "pointer",
                                        flexShrink: 0, transition: "all 0.12s",
                                    }}
                                    onMouseEnter={e => { if (!busy && !isKept) { e.currentTarget.style.background = "rgba(200,80,80,0.1)"; e.currentTarget.style.borderColor = "rgba(200,80,80,0.5)"; } }}
                                    onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = busy || isKept ? "rgba(245,237,214,0.06)" : "rgba(200,80,80,0.28)"; }}
                                >
                                    {busy ? "…" : "Sil"}
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

export default function DuplicatesPage() {
    const toast = useToast();
    const [home,         setHome]         = useState<string>("");
    const [selectedDirs, setSelectedDirs] = useState<Set<string>>(
        () => new Set(DIR_OPTIONS.map(d => d.sub))
    );
    const [report,       setReport]       = useState<DuplicateReport | null>(null);
    const [groups,       setGroups]       = useState<MutableGroup[]>([]);
    const [scanning,     setScanning]     = useState(false);
    const [cleaningAll,  setCleaningAll]  = useState(false);
    const [progress,     setProgress]     = useState<DupProgress | null>(null);
    const [keepStrategy, setKeepStrategy] = useState<KeepStrategy>("newest");
    useEffect(() => {
        invoke<string>("get_home_path").then(setHome).catch(() => {});

        let mounted = true;
        let unlistenFn: (() => void) | null = null;

        listen<DupProgress>("dup_progress", (e) => {
            if (mounted) setProgress(e.payload);
        }).then(unlisten => {
            if (!mounted) unlisten();
            else unlistenFn = unlisten;
        });

        return () => {
            mounted = false;
            unlistenFn?.();
        };
    }, []);

    const toggleDir = (sub: string) => {
        setSelectedDirs(prev => {
            const next = new Set(prev);
            if (next.has(sub)) {
                if (next.size > 1) next.delete(sub);
            } else {
                next.add(sub);
            }
            return next;
        });
    };

    const scan = async () => {
        const roots = Array.from(selectedDirs).map(sub => `${home}/${sub}`);
        setScanning(true); setReport(null); setGroups([]); setProgress(null);
        try {
            const r = await invoke<DuplicateReport>("find_duplicate_files", { roots });
            setReport(r);
            setGroups(r.groups.map(g => ({
                ...g,
                files: g.files.map(f => ({ ...f, deleted: false })),
            })));
        } catch (e) { toast.error(String(e)); }
        setScanning(false);
        setProgress(null);
    };

    const handleTrash = async (groupIdx: number, path: string) => {
        try {
            await invoke("trash_duplicate_file", { path });
            setGroups(prev => prev.map((g, i) => {
                if (i !== groupIdx) return g;
                const files = g.files.map(f => f.path === path ? { ...f, deleted: true } : f);
                const liveCount = files.filter(f => !f.deleted).length;
                const wasted = liveCount > 1 ? g.size * (liveCount - 1) : 0;
                return { ...g, files, wasted };
            }));
        } catch (e) { toast.error(String(e)); }
    };

    const handleCleanAll = async () => {
        setCleaningAll(true);
        const toTrash: { groupIdx: number; path: string }[] = [];
        groups.forEach((g, gi) => {
            const live = g.files.filter(f => !f.deleted);
            if (live.length < 2) return;
            const keepPath = pickKeeper(live, keepStrategy);
            live.filter(f => f.path !== keepPath).forEach(f => toTrash.push({ groupIdx: gi, path: f.path }));
        });
        let failed = 0;
        for (const { groupIdx, path } of toTrash) {
            try {
                await invoke("trash_duplicate_file", { path });
                setGroups(prev => prev.map((g, i) => {
                    if (i !== groupIdx) return g;
                    const files = g.files.map(f => f.path === path ? { ...f, deleted: true } : f);
                    const liveCount = files.filter(f => !f.deleted).length;
                    return { ...g, files, wasted: liveCount > 1 ? g.size * (liveCount - 1) : 0 };
                }));
            } catch { failed++; }
        }
        if (failed > 0) toast.error(`${failed} dosya çöp kutusuna taşınamadı.`);
        setCleaningAll(false);
    };

    const activeGroups = groups.filter(g => g.files.filter(f => !f.deleted).length >= 2);
    const savedBytes   = groups.reduce((acc, g) => {
        const trashed = g.files.filter(f => f.deleted).length;
        return acc + g.size * trashed;
    }, 0);

    return (
        <div className="fade-in" style={{ padding: "24px 28px", display: "flex", flexDirection: "column", gap: 16 }}>

            {/* Page title */}
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, color: "#F5EDD6", fontFamily: "'New York', 'Iowan Old Style', Georgia, serif", letterSpacing: "-0.02em" }}>
                Kopyalar
            </h1>

            {/* Toolbar */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                {/* Directory chips */}
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", flex: 1 }}>
                    {DIR_OPTIONS.map(d => {
                        const active = selectedDirs.has(d.sub);
                        return (
                            <button
                                key={d.sub}
                                onClick={() => toggleDir(d.sub)}
                                style={{
                                    padding: "4px 12px", fontSize: 11, fontWeight: 600,
                                    borderRadius: 99, cursor: "pointer", transition: "all 0.12s",
                                    color:      active ? "#F5EDD6"               : "rgba(245,237,214,0.32)",
                                    background: active ? "rgba(245,237,214,0.14)" : "transparent",
                                    border:     active ? "1px solid rgba(245,237,214,0.35)" : "1px solid rgba(245,237,214,0.1)",
                                }}
                            >
                                {d.label}
                            </button>
                        );
                    })}
                </div>

                <button
                    onClick={scan} disabled={scanning}
                    style={{
                        padding: "7px 20px",
                        background: scanning ? "rgba(245,237,214,0.07)" : "#F5EDD6",
                        border: "1px solid rgba(245,237,214,0.45)",
                        borderRadius: 99, fontSize: 13, fontWeight: 700,
                        color: scanning ? "rgba(245,237,214,0.3)" : "#150b00",
                        cursor: scanning ? "not-allowed" : "pointer",
                        flexShrink: 0, transition: "all 0.15s",
                    }}
                    onMouseEnter={e => { if (!scanning) e.currentTarget.style.background = "rgba(245,237,214,0.82)"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = scanning ? "rgba(245,237,214,0.07)" : "#F5EDD6"; }}
                >
                    {scanning ? "Taranıyor…" : "Şimdi Tara"}
                </button>
            </div>

            {/* Scanning state */}
            {scanning && (
                <div style={{ ...card, borderRadius: 14, padding: "24px 28px", display: "flex", flexDirection: "column", gap: 14 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <div style={{
                            width: 20, height: 20, borderRadius: 10, flexShrink: 0,
                            border: "2px solid rgba(245,237,214,0.16)",
                            borderTop: "2px solid rgba(245,237,214,0.85)",
                            animation: "spin 0.8s linear infinite",
                        }} />
                        <span style={{ fontSize: 13, fontWeight: 600, color: "rgba(245,237,214,0.7)" }}>
                            {!progress || progress.phase === "walking"
                                ? `Dosyalar taranıyor… ${progress ? progress.count.toLocaleString("tr-TR") : ""}`
                                : progress.phase === "hashing"
                                ? `Hash hesaplanıyor… ${progress.count.toLocaleString("tr-TR")} / ${progress.total.toLocaleString("tr-TR")}`
                                : "Tamamlanıyor…"
                            }
                        </span>
                    </div>

                    {progress && progress.phase === "hashing" && progress.total > 0 && (
                        <div style={{ width: "100%", background: "rgba(245,237,214,0.08)", borderRadius: 99, height: 4 }}>
                            <div style={{
                                height: 4, borderRadius: 99,
                                width: `${Math.min(100, (progress.count / progress.total) * 100)}%`,
                                background: "rgba(245,237,214,0.85)",
                                transition: "width 0.3s ease",
                            }} />
                        </div>
                    )}

                    {progress?.current && (
                        <p style={{ margin: 0, fontSize: 10, color: "rgba(245,237,214,0.22)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {progress.current}
                        </p>
                    )}
                </div>
            )}

            {/* Summary banner */}
            {report && !scanning && (
                <div style={{
                    borderRadius: 14, padding: "16px 18px",
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    flexWrap: "wrap", gap: 12,
                    background: "rgba(245,237,214,0.07)",
                    border: "1px solid rgba(245,237,214,0.18)",
                }}>
                    <div>
                        <span style={{ fontSize: 26, fontWeight: 800, color: "#F5EDD6", fontFamily: "'New York', 'Iowan Old Style', Georgia, serif" }}>
                            {report.total_wasted_human}
                        </span>
                        <p style={{ margin: "2px 0 0", fontSize: 11, color: "rgba(245,237,214,0.32)" }}>
                            {report.groups.length} kopya grubunda israf · {report.files_scanned.toLocaleString("tr-TR")} dosya tarandı
                        </p>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", justifyContent: "flex-end" }}>
                        {savedBytes > 0 && (
                            <div style={{ textAlign: "right" }}>
                                <span style={{ fontSize: 16, fontWeight: 700, color: "rgba(245,237,214,0.7)" }}>
                                    {formatBytes(savedBytes)} kurtarıldı
                                </span>
                                <p style={{ margin: "2px 0 0", fontSize: 11, color: "rgba(245,237,214,0.25)" }}>bu oturumda</p>
                            </div>
                        )}
                        {activeGroups.length > 0 && (
                            <>
                                <StrategyPicker value={keepStrategy} onChange={setKeepStrategy} />
                                <button
                                    onClick={handleCleanAll}
                                    disabled={cleaningAll}
                                    style={{
                                        padding: "8px 20px", fontSize: 13, fontWeight: 700,
                                        color: cleaningAll ? "rgba(245,237,214,0.3)" : "#150b00",
                                        background: cleaningAll ? "rgba(245,237,214,0.07)" : "#F5EDD6",
                                        border: "1px solid rgba(245,237,214,0.45)",
                                        borderRadius: 99, cursor: cleaningAll ? "not-allowed" : "pointer",
                                        transition: "all 0.15s", whiteSpace: "nowrap",
                                    }}
                                    onMouseEnter={e => { if (!cleaningAll) e.currentTarget.style.background = "rgba(245,237,214,0.82)"; }}
                                    onMouseLeave={e => { e.currentTarget.style.background = cleaningAll ? "rgba(245,237,214,0.07)" : "#F5EDD6"; }}
                                >
                                    {cleaningAll ? "Temizleniyor…" : "Tümünü Temizle"}
                                </button>
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* No duplicates */}
            {report && !scanning && report.groups.length === 0 && (
                <div style={{ textAlign: "center", padding: "52px 0" }}>
                    <p style={{ fontSize: 18, fontWeight: 700, fontFamily: "'New York', 'Iowan Old Style', Georgia, serif", color: "rgba(245,237,214,0.4)", margin: "0 0 8px" }}>
                        Kopya bulunamadı
                    </p>
                    <p style={{ fontSize: 12, color: "rgba(245,237,214,0.22)", margin: 0 }}>
                        Seçili klasörleriniz temiz
                    </p>
                </div>
            )}

            {/* All resolved */}
            {report && !scanning && report.groups.length > 0 && activeGroups.length === 0 && (
                <div style={{ textAlign: "center", padding: "52px 0" }}>
                    <p style={{ fontSize: 18, fontWeight: 700, fontFamily: "'New York', 'Iowan Old Style', Georgia, serif", color: "rgba(245,237,214,0.45)", margin: "0 0 8px" }}>
                        Tüm kopyalar çözümlendi
                    </p>
                    <p style={{ fontSize: 12, color: "rgba(245,237,214,0.22)", margin: 0 }}>
                        Daha fazlası için yeniden tarayın
                    </p>
                </div>
            )}

            {/* Groups */}
            {!scanning && groups.map((group, gi) => {
                const live = group.files.filter(f => !f.deleted);
                if (live.length < 2) return null;
                return (
                    <GroupCard
                        key={gi}
                        group={group}
                        strategy={keepStrategy}
                        onTrash={(path) => handleTrash(gi, path)}
                    />
                );
            })}

            {/* Empty state */}
            {!report && !scanning && (
                <div style={{ textAlign: "center", padding: "60px 0" }}>
                    <p style={{ fontSize: 18, fontWeight: 700, fontFamily: "'New York', 'Iowan Old Style', Georgia, serif", color: "rgba(245,237,214,0.35)", margin: "0 0 8px" }}>
                        Kopya dosyaları bul
                    </p>
                    <p style={{ fontSize: 12, color: "rgba(245,237,214,0.2)", margin: 0 }}>
                        SHA-256 doğrulamalı · yukarıdan klasör seçin ve tarayın
                    </p>
                </div>
            )}

            <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
        </div>
    );
}
