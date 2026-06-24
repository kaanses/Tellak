import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useToast } from "../../shared/store/toastStore";
import { useI18n } from "../../shared/i18n";

interface LoginItem {
    name: string;
    path: string;
    program: string;
    enabled: boolean;
    location: "user" | "global" | "daemon";
    is_apple: boolean;
}

const card = {
    background: "rgba(245,237,214,0.04)",
    border: "1px solid rgba(245,237,214,0.1)",
} as const;

const LOC_LABEL_KEY: Record<string, string> = {
    user:   "startup.locUser",
    global: "startup.locGlobal",
    daemon: "startup.locDaemon",
};

const LOC_COLOR: Record<string, string> = {
    user:   "#F5EDD6",
    global: "rgba(245,237,214,0.55)",
    daemon: "rgba(245,237,214,0.38)",
};

function Toggle({ enabled, onChange, disabled }: {
    enabled: boolean; onChange: () => void; disabled?: boolean;
}) {
    const { t } = useI18n();
    return (
        <button
            onClick={() => !disabled && onChange()}
            title={disabled ? t("startup.toggleLocked") : enabled ? t("startup.toggleDisable") : t("startup.toggleEnable")}
            style={{
                width: 38, height: 21, borderRadius: 11,
                border: "none", padding: 0, flexShrink: 0,
                background: disabled
                    ? "rgba(245,237,214,0.07)"
                    : enabled ? "rgba(245,237,214,0.85)" : "rgba(245,237,214,0.1)",
                cursor: disabled ? "default" : "pointer",
                position: "relative",
                transition: "background 0.2s",
            }}
        >
            <div style={{
                position: "absolute",
                top: 2.5,
                left: enabled ? 19 : 2.5,
                width: 16, height: 16, borderRadius: 8,
                background: disabled ? "rgba(245,237,214,0.2)" : "#F5EDD6",
                transition: "left 0.2s cubic-bezier(0.4,0,0.2,1)",
                boxShadow: "0 1px 3px rgba(0,0,0,0.35)",
            }} />
        </button>
    );
}

function RowSkeleton() {
    return (
        <div style={{
            display: "flex", alignItems: "center", gap: 12,
            padding: "11px 16px", borderBottom: "1px solid rgba(245,237,214,0.06)",
        }}>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 5 }}>
                <div className="shimmer" style={{ width: 170, height: 12, borderRadius: 5 }} />
                <div className="shimmer" style={{ width: 240, height: 9,  borderRadius: 4 }} />
            </div>
            <div className="shimmer" style={{ width: 38, height: 21, borderRadius: 11 }} />
            <div className="shimmer" style={{ width: 50, height: 26, borderRadius: 99 }} />
        </div>
    );
}

export default function StartupPage() {
    const { t } = useI18n();
    const toast = useToast();
    const [items,    setItems]    = useState<LoginItem[]>([]);
    const [loading,  setLoading]  = useState(true);
    const [search,   setSearch]   = useState("");
    const [toggling, setToggling] = useState<string | null>(null);
    const [deleting, setDeleting] = useState<string | null>(null);
    const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

    const load = async () => {
        setLoading(true);
        try { setItems(await invoke<LoginItem[]>("get_login_items")); }
        catch (e) { toast.error(String(e)); }
        setLoading(false);
    };

    useEffect(() => { load(); }, []);

    const handleToggle = async (item: LoginItem) => {
        setToggling(item.path);
        try {
            const newPath = await invoke<string>("toggle_login_item", {
                path: item.path,
                enable: !item.enabled,
            });
            setItems(prev => prev.map(i =>
                i.path === item.path ? { ...i, path: newPath, enabled: !i.enabled } : i
            ));
        } catch (e) { toast.error(String(e)); }
        setToggling(null);
    };

    const handleDelete = async (item: LoginItem) => {
        if (confirmDelete !== item.path) {
            setConfirmDelete(item.path);
            return;
        }
        setConfirmDelete(null);
        setDeleting(item.path);
        try {
            await invoke("delete_login_item", { path: item.path });
            setItems(prev => prev.filter(i => i.path !== item.path));
        } catch (e) {
            const msg = String(e);
            toast.error(item.location === "daemon"
                ? `${msg}${t("startup.manualDeleteHint", { path: item.path })}`
                : msg);
        }
        setDeleting(null);
    };

    const query    = search.toLowerCase();
    const filtered = items.filter(i =>
        i.name.toLowerCase().includes(query) ||
        i.program.toLowerCase().includes(query)
    );
    const modifiable = filtered.filter(i => !i.is_apple);

    return (
        <div className="fade-in" style={{ padding: "24px 28px", display: "flex", flexDirection: "column", gap: 16 }}>

            {/* Page title */}
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, color: "#F5EDD6", fontFamily: "'New York', 'Iowan Old Style', Georgia, serif", letterSpacing: "-0.02em" }}>
                {t("startup.title")}
            </h1>

            {/* Toolbar */}
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {items.length > 0 && (
                    <input
                        type="text"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder={t("startup.searchPlaceholder")}
                        style={{
                            flex: 1, padding: "8px 14px",
                            background: "rgba(245,237,214,0.04)",
                            border: "1px solid rgba(245,237,214,0.11)",
                            borderRadius: 10, fontSize: 13, color: "#F5EDD6",
                            outline: "none", transition: "border-color 0.15s",
                        }}
                        onFocus={e => (e.currentTarget.style.borderColor = "rgba(245,237,214,0.4)")}
                        onBlur={e  => (e.currentTarget.style.borderColor = "rgba(245,237,214,0.11)")}
                    />
                )}
                <button
                    onClick={load} disabled={loading}
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
                    {loading ? t("startup.loading") : t("startup.refresh")}
                </button>
            </div>

            {/* Skeleton */}
            {loading && (
                <div style={{ ...card, borderRadius: 14, overflow: "hidden" }}>
                    {Array.from({ length: 8 }).map((_, i) => <RowSkeleton key={i} />)}
                </div>
            )}

            {/* Groups */}
            {!loading && (["user", "global", "daemon"] as const).map(loc => {
                const group = filtered.filter(i => i.location === loc);
                if (group.length === 0) return null;
                const color = LOC_COLOR[loc];

                return (
                    <div key={loc} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {/* Section header */}
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div style={{ width: 5, height: 5, borderRadius: 3, background: color, flexShrink: 0 }} />
                            <span style={{ fontSize: 11, fontWeight: 600, color, textTransform: "uppercase", letterSpacing: "0.1em" }}>
                                {t(LOC_LABEL_KEY[loc])}
                            </span>
                            <span style={{ fontSize: 10, color: "rgba(245,237,214,0.22)" }}>
                                {t("startup.itemCount", { count: group.length })}
                            </span>
                        </div>

                        {/* Item list */}
                        <div style={{ ...card, borderRadius: 14, overflow: "hidden" }}>
                            {/* Daemon note */}
                            {loc === "daemon" && (
                                <div style={{ padding: "8px 16px 4px", fontSize: 11, color: "rgba(245,237,214,0.28)", display: "flex", alignItems: "center", gap: 6 }}>
                                    <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} style={{ flexShrink: 0 }}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                                    </svg>
                                    {t("startup.daemonNote")}
                                </div>
                            )}

                            {group.map((item, i) => {
                                const isReadOnly = item.is_apple;
                                return (
                                    <div
                                        key={item.path}
                                        style={{
                                            display: "flex", alignItems: "center", gap: 12,
                                            padding: "11px 16px",
                                            borderBottom: i < group.length - 1 ? "1px solid rgba(245,237,214,0.06)" : "none",
                                            opacity: isReadOnly ? 0.38 : 1,
                                            transition: "background 0.12s",
                                        }}
                                        onMouseEnter={e => { if (!isReadOnly) (e.currentTarget as HTMLElement).style.background = "rgba(245,237,214,0.03)"; }}
                                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                                    >
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                                <span style={{ fontSize: 13, fontWeight: 500, color: "#F5EDD6" }}>
                                                    {item.name}
                                                </span>
                                                {item.is_apple && (
                                                    <span style={{
                                                        fontSize: 9, color: "rgba(245,237,214,0.3)",
                                                        background: "rgba(245,237,214,0.05)",
                                                        border: "1px solid rgba(245,237,214,0.1)",
                                                        padding: "1px 5px", borderRadius: 4,
                                                        letterSpacing: "0.08em", fontWeight: 600,
                                                    }}>
                                                        {t("startup.badgeSystem")}
                                                    </span>
                                                )}
                                                {item.location === "daemon" && !item.is_apple && (
                                                    <span style={{
                                                        fontSize: 9, color: "rgba(245,237,214,0.4)",
                                                        background: "rgba(245,237,214,0.06)",
                                                        border: "1px solid rgba(245,237,214,0.12)",
                                                        padding: "1px 5px", borderRadius: 4,
                                                        letterSpacing: "0.08em", fontWeight: 600,
                                                    }}>
                                                        DAEMON
                                                    </span>
                                                )}
                                                {!item.enabled && !isReadOnly && (
                                                    <span style={{
                                                        fontSize: 9, color: "rgba(200,80,80,0.7)",
                                                        background: "rgba(200,80,80,0.08)",
                                                        border: "1px solid rgba(200,80,80,0.2)",
                                                        padding: "1px 5px", borderRadius: 4,
                                                        letterSpacing: "0.08em", fontWeight: 600,
                                                    }}>
                                                        {t("startup.badgeOff")}
                                                    </span>
                                                )}
                                            </div>
                                            {item.program && (
                                                <div style={{
                                                    fontSize: 10, color: "rgba(245,237,214,0.22)",
                                                    marginTop: 2, overflow: "hidden",
                                                    textOverflow: "ellipsis", whiteSpace: "nowrap",
                                                }}>
                                                    {item.program}
                                                </div>
                                            )}
                                        </div>

                                        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                                            <Toggle
                                                enabled={item.enabled}
                                                disabled={isReadOnly || toggling === item.path}
                                                onChange={() => handleToggle(item)}
                                            />

                                            {!isReadOnly && (
                                                confirmDelete === item.path ? (
                                                    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                                                        <button
                                                            onClick={() => handleDelete(item)}
                                                            disabled={deleting === item.path}
                                                            style={{
                                                                padding: "4px 10px", fontSize: 11, fontWeight: 600,
                                                                color: "#F5EDD6", background: "rgba(200,80,80,0.22)",
                                                                border: "1px solid rgba(200,80,80,0.45)",
                                                                borderRadius: 99, cursor: "pointer", transition: "all 0.12s",
                                                            }}
                                                            onMouseEnter={e => { e.currentTarget.style.background = "rgba(200,80,80,0.38)"; }}
                                                            onMouseLeave={e => { e.currentTarget.style.background = "rgba(200,80,80,0.22)"; }}
                                                        >
                                                            {deleting === item.path ? "…" : t("startup.delete")}
                                                        </button>
                                                        <button
                                                            onClick={() => setConfirmDelete(null)}
                                                            style={{
                                                                padding: "4px 8px", fontSize: 11,
                                                                color: "rgba(245,237,214,0.38)",
                                                                background: "transparent",
                                                                border: "1px solid rgba(245,237,214,0.12)",
                                                                borderRadius: 99, cursor: "pointer",
                                                            }}
                                                        >✕</button>
                                                    </div>
                                                ) : (
                                                    <button
                                                        onClick={() => handleDelete(item)}
                                                        disabled={deleting === item.path}
                                                        style={{
                                                            padding: "4px 12px", fontSize: 11,
                                                            color: deleting === item.path ? "rgba(245,237,214,0.2)" : "rgba(210,90,90,0.9)",
                                                            background: "transparent",
                                                            border: `1px solid ${deleting === item.path ? "rgba(245,237,214,0.06)" : "rgba(200,80,80,0.28)"}`,
                                                            borderRadius: 99,
                                                            cursor: deleting === item.path ? "not-allowed" : "pointer",
                                                            transition: "all 0.12s",
                                                        }}
                                                        onMouseEnter={e => { if (deleting !== item.path) { e.currentTarget.style.background = "rgba(200,80,80,0.1)"; e.currentTarget.style.borderColor = "rgba(200,80,80,0.5)"; } }}
                                                        onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = deleting === item.path ? "rgba(245,237,214,0.06)" : "rgba(200,80,80,0.28)"; }}
                                                    >
                                                        {deleting === item.path ? "…" : t("startup.delete")}
                                                    </button>
                                                )
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                );
            })}

            {/* No search results */}
            {!loading && items.length > 0 && filtered.length === 0 && (
                <div style={{ textAlign: "center", padding: "48px 0", fontSize: 14, fontFamily: "'New York', 'Iowan Old Style', Georgia, serif", color: "rgba(245,237,214,0.3)" }}>
                    {t("startup.noMatch", { search })}
                </div>
            )}

            {/* Empty state */}
            {!loading && items.length === 0 && (
                <div style={{ textAlign: "center", padding: "60px 0" }}>
                    <p style={{ fontSize: 14, fontFamily: "'New York', 'Iowan Old Style', Georgia, serif", color: "rgba(245,237,214,0.3)", margin: 0 }}>{t("startup.empty")}</p>
                </div>
            )}

            {/* Footer count */}
            {!loading && items.length > 0 && (
                <div style={{ fontSize: 10, color: "rgba(245,237,214,0.18)", textAlign: "right" }}>
                    {t("startup.footerCount", { modifiable: modifiable.length, total: filtered.length })}
                </div>
            )}
        </div>
    );
}
