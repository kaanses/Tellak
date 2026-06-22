import { useState, useEffect, useMemo } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { useToast } from "../../shared/store/toastStore";

interface AppInfo {
    name: string; path: string; bundle_id: string;
    size: string; size_bytes: number; last_used: string; last_used_ts: number; icon_path: string;
}

type SortState = 0 | 1 | 2;

const card = {
    background: "rgba(245,237,214,0.04)",
    border: "1px solid rgba(245,237,214,0.1)",
} as const;

function Shimmer({ w, h }: { w: number | string; h: number | string }) {
    return <div className="shimmer" style={{ width: w, height: h }} />;
}

function AppIcon({ iconPath, name }: { iconPath: string; name: string }) {
    const [failed, setFailed] = useState(false);
    if (!iconPath || failed) {
        return (
            <div style={{
                width: 40, height: 40, borderRadius: 10, flexShrink: 0,
                background: "rgba(245,237,214,0.1)",
                border: "1px solid rgba(245,237,214,0.16)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 17, fontWeight: 700, color: "rgba(245,237,214,0.55)",
                fontFamily: "'New York', 'Iowan Old Style', Georgia, serif",
            }}>
                {name.charAt(0).toUpperCase()}
            </div>
        );
    }
    return (
        <img
            src={convertFileSrc(iconPath)} alt={name} onError={() => setFailed(true)}
            style={{ width: 40, height: 40, borderRadius: 10, flexShrink: 0, objectFit: "contain" }}
        />
    );
}

function AppRowSkeleton() {
    return (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: "1px solid rgba(245,237,214,0.06)" }}>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
                <Shimmer w={140} h={13} />
                <Shimmer w={80}  h={10} />
            </div>
            <Shimmer w={72} h={30} />
        </div>
    );
}

function nextSort(s: SortState): SortState {
    return ((s + 1) % 3) as SortState;
}

function SortBtn({ label, state, onClick }: { label: string; state: SortState; onClick: () => void }) {
    const active = state !== 0;
    const arrow = state === 1 ? " ↑" : state === 2 ? " ↓" : "";
    return (
        <button
            onClick={onClick}
            style={{
                padding: "7px 12px", fontSize: 12, fontWeight: 600,
                color: active ? "#F5EDD6" : "rgba(245,237,214,0.38)",
                background: active ? "rgba(245,237,214,0.11)" : "rgba(245,237,214,0.03)",
                border: `1px solid ${active ? "rgba(245,237,214,0.28)" : "rgba(245,237,214,0.08)"}`,
                borderRadius: 10, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0,
                transition: "all 0.15s",
            }}
            onMouseEnter={e => { e.currentTarget.style.background = active ? "rgba(245,237,214,0.18)" : "rgba(245,237,214,0.07)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = active ? "rgba(245,237,214,0.11)" : "rgba(245,237,214,0.03)"; }}
        >
            {label}{arrow}
        </button>
    );
}

function UninstallBtn({ app, onUninstall, uninstalling }: {
    app: AppInfo; onUninstall: (app: AppInfo) => void; uninstalling: boolean;
}) {
    const [confirming, setConfirming] = useState(false);

    if (confirming) {
        return (
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                <span style={{ fontSize: 11, color: "rgba(245,237,214,0.38)" }}>Emin misin?</span>
                <button
                    onClick={() => { setConfirming(false); onUninstall(app); }}
                    style={{
                        padding: "4px 12px", fontSize: 11, fontWeight: 600,
                        color: "#F5EDD6", background: "rgba(200,80,80,0.22)",
                        border: "1px solid rgba(200,80,80,0.45)",
                        borderRadius: 99, cursor: "pointer", transition: "all 0.15s",
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = "rgba(200,80,80,0.38)"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "rgba(200,80,80,0.22)"; }}
                >
                    Çöp Kutusuna Taşı
                </button>
                <button
                    onClick={() => setConfirming(false)}
                    style={{
                        padding: "4px 10px", fontSize: 11,
                        color: "rgba(245,237,214,0.38)",
                        background: "transparent",
                        border: "1px solid rgba(245,237,214,0.12)",
                        borderRadius: 99, cursor: "pointer", transition: "all 0.15s",
                    }}
                >
                    Vazgeç
                </button>
            </div>
        );
    }

    return (
        <button
            onClick={() => setConfirming(true)}
            disabled={uninstalling}
            style={{
                padding: "5px 14px", fontSize: 12,
                color: uninstalling ? "rgba(245,237,214,0.2)" : "rgba(210,90,90,0.9)",
                background: "transparent",
                border: `1px solid ${uninstalling ? "rgba(245,237,214,0.06)" : "rgba(200,80,80,0.28)"}`,
                borderRadius: 99,
                cursor: uninstalling ? "not-allowed" : "pointer",
                flexShrink: 0, marginLeft: 12, transition: "all 0.12s",
            }}
            onMouseEnter={e => { if (!uninstalling) { e.currentTarget.style.background = "rgba(200,80,80,0.1)"; e.currentTarget.style.borderColor = "rgba(200,80,80,0.5)"; } }}
            onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = uninstalling ? "rgba(245,237,214,0.06)" : "rgba(200,80,80,0.28)"; }}
        >
            {uninstalling ? "Kaldırılıyor…" : "Kaldır"}
        </button>
    );
}

export default function UninstallerPage() {
    const toast = useToast();
    const [apps,         setApps]         = useState<AppInfo[]>([]);
    const [loading,      setLoading]      = useState(false);
    const [search,       setSearch]       = useState("");
    const [uninstalling, setUninstalling] = useState<string | null>(null);
    const [sizeSort,     setSizeSort]     = useState<SortState>(0);
    const [usedSort,     setUsedSort]     = useState<SortState>(0);

    const loadApps = async (force = false) => {
        setLoading(true);
        try { setApps(await invoke<AppInfo[]>("get_installed_apps", { force })); }
        catch (e) { toast.error(String(e)); }
        setLoading(false);
    };

    useEffect(() => { loadApps(false); }, []);

    const handleUninstall = async (app: AppInfo) => {
        setUninstalling(app.path);
        try {
            const result = await invoke<string>("uninstall_app", { appPath: app.path });
            toast.success(result);
            setApps(prev => prev.filter(a => a.path !== app.path));
        } catch (e) { toast.error(String(e)); }
        setUninstalling(null);
    };

    const duplicateInfo = useMemo(() => {
        const maxSize = new Map<string, number>();
        for (const a of apps) {
            if ((maxSize.get(a.name) ?? 0) < a.size_bytes) maxSize.set(a.name, a.size_bytes);
        }
        const counts = new Map<string, number>();
        for (const a of apps) counts.set(a.name, (counts.get(a.name) ?? 0) + 1);
        const dupeNames = new Set([...counts.entries()].filter(([, n]) => n > 1).map(([name]) => name));
        return { dupeNames, maxSize };
    }, [apps]);

    const filtered = useMemo(() => {
        let list = apps.filter(a => a.name.toLowerCase().includes(search.toLowerCase()));

        if (sizeSort !== 0) {
            list = [...list].sort((a, b) =>
                sizeSort === 1 ? a.size_bytes - b.size_bytes : b.size_bytes - a.size_bytes
            );
        } else if (usedSort !== 0) {
            list = [...list].sort((a, b) => {
                if (!a.last_used_ts && !b.last_used_ts) return 0;
                if (!a.last_used_ts) return 1;
                if (!b.last_used_ts) return -1;
                return usedSort === 1 ? a.last_used_ts - b.last_used_ts : b.last_used_ts - a.last_used_ts;
            });
        } else {
            list = [...list].sort((a, b) => {
                if (a.name === b.name) return b.size_bytes - a.size_bytes;
                return 0;
            });
        }
        return list;
    }, [apps, search, sizeSort, usedSort]);

    return (
        <div className="fade-in" style={{ padding: "24px 28px", display: "flex", flexDirection: "column", gap: 16 }}>

            {/* Page title */}
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, color: "#F5EDD6", fontFamily: "'New York', 'Iowan Old Style', Georgia, serif", letterSpacing: "-0.02em" }}>
                Uygulamalar
            </h1>

            {/* Toolbar */}
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {apps.length > 0 && (
                    <input
                        type="text" value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Uygulama ara…"
                        style={{
                            width: 220, flexShrink: 0,
                            padding: "8px 14px",
                            background: "rgba(245,237,214,0.04)",
                            border: "1px solid rgba(245,237,214,0.11)",
                            borderRadius: 10, fontSize: 13, color: "#F5EDD6",
                            outline: "none", transition: "border-color 0.15s",
                        }}
                        onFocus={e  => (e.currentTarget.style.borderColor = "rgba(245,237,214,0.4)")}
                        onBlur={e   => (e.currentTarget.style.borderColor = "rgba(245,237,214,0.11)")}
                    />
                )}

                <SortBtn label="Boyut" state={sizeSort} onClick={() => { setSizeSort(nextSort(sizeSort)); setUsedSort(0); }} />
                <SortBtn label="Son Kullanım" state={usedSort} onClick={() => { setUsedSort(nextSort(usedSort)); setSizeSort(0); }} />

                <div style={{ flex: 1 }} />

                <button
                    onClick={() => loadApps(true)} disabled={loading}
                    style={{
                        padding: "8px 16px",
                        background: "rgba(245,237,214,0.05)",
                        border: "1px solid rgba(245,237,214,0.12)",
                        borderRadius: 10, fontSize: 13,
                        color: loading ? "rgba(245,237,214,0.2)" : "rgba(245,237,214,0.5)",
                        cursor: loading ? "not-allowed" : "pointer",
                        whiteSpace: "nowrap", flexShrink: 0, transition: "all 0.15s",
                    }}
                    onMouseEnter={e => { if (!loading) e.currentTarget.style.background = "rgba(245,237,214,0.1)"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "rgba(245,237,214,0.05)"; }}
                >
                    {loading ? "Yükleniyor…" : "Yenile"}
                </button>
            </div>

            {/* Skeleton */}
            {loading && (
                <div style={{ ...card, borderRadius: 14, overflow: "hidden" }}>
                    {Array.from({ length: 10 }).map((_, i) => <AppRowSkeleton key={i} />)}
                </div>
            )}

            {/* App list */}
            {!loading && filtered.length > 0 && (
                <div style={{ ...card, borderRadius: 14, overflow: "hidden" }}>
                    {filtered.map((app, i) => {
                        const isLarger  = app.size_bytes >= (duplicateInfo.maxSize.get(app.name) ?? 0);
                        const isDupe    = duplicateInfo.dupeNames.has(app.name);
                        return (
                            <div
                                key={app.path}
                                style={{
                                    display: "flex", alignItems: "center", justifyContent: "space-between",
                                    gap: 14, padding: "10px 16px",
                                    borderBottom: i < filtered.length - 1 ? "1px solid rgba(245,237,214,0.06)" : "none",
                                    transition: "background 0.12s",
                                }}
                                onMouseEnter={e => ((e.currentTarget as HTMLElement).style.background = "rgba(245,237,214,0.03)")}
                                onMouseLeave={e => ((e.currentTarget as HTMLElement).style.background = "transparent")}
                            >
                                <AppIcon iconPath={app.icon_path} name={app.name} />
                                <div style={{ minWidth: 0, flex: 1 }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                        <span style={{ fontSize: 13, fontWeight: 500, color: "#F5EDD6" }}>{app.name}</span>
                                        {isDupe && (
                                            <span style={{
                                                fontSize: 9, fontWeight: 700, letterSpacing: "0.08em",
                                                padding: "1px 5px", borderRadius: 4, flexShrink: 0,
                                                ...(isLarger
                                                    ? { color: "#F5EDD6", background: "rgba(245,237,214,0.1)", border: "1px solid rgba(245,237,214,0.25)" }
                                                    : { color: "rgba(245,237,214,0.45)", background: "rgba(245,237,214,0.06)", border: "1px solid rgba(245,237,214,0.15)" }
                                                ),
                                            }}>
                                                {isLarger ? "ASIL" : "YEDEK"}
                                            </span>
                                        )}
                                    </div>
                                    <div style={{ display: "flex", gap: 10, marginTop: 2 }}>
                                        <span style={{ fontSize: 11, color: "rgba(245,237,214,0.32)" }}>{app.size}</span>
                                        {app.last_used && app.last_used !== "Unknown" && (
                                            <span style={{ fontSize: 11, color: "rgba(245,237,214,0.22)" }}>Son kullanım: {app.last_used}</span>
                                        )}
                                    </div>
                                    <div style={{
                                        fontSize: 10, color: "rgba(245,237,214,0.18)", marginTop: 1,
                                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                                    }}>
                                        {app.path.replace(/^\/Users\/[^/]+/, "~")}
                                    </div>
                                </div>
                                <UninstallBtn
                                    app={app}
                                    onUninstall={handleUninstall}
                                    uninstalling={uninstalling === app.path}
                                />
                            </div>
                        );
                    })}
                </div>
            )}

            {!loading && apps.length > 0 && filtered.length === 0 && (
                <div style={{ textAlign: "center", padding: "48px 0", fontSize: 14, fontFamily: "'New York', 'Iowan Old Style', Georgia, serif", color: "rgba(245,237,214,0.3)" }}>
                    "{search}" ile eşleşen uygulama yok
                </div>
            )}

            {!loading && apps.length > 0 && (
                <div style={{ fontSize: 10, color: "rgba(245,237,214,0.18)", textAlign: "right" }}>
                    {apps.length} uygulamadan {filtered.length} tanesi
                </div>
            )}
        </div>
    );
}
