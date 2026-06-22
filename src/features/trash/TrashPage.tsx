import { useState, useEffect } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { useToast } from "../../shared/store/toastStore";

interface TrashItem {
    name: string;
    path: string;
    size: number;
    size_human: string;
    is_icloud: boolean;
}

interface TrashInfo {
    items: TrashItem[];
    total_size: number;
    total_size_human: string;
}

const card = {
    background: "rgba(245,237,214,0.04)",
    border: "1px solid rgba(245,237,214,0.1)",
} as const;

function humanizeBytes(bytes: number) {
    if (bytes === 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let i = 0, s = bytes;
    while (s >= 1024 && i < units.length - 1) { s /= 1024; i++; }
    return i === 0 ? `${bytes} B` : `${s.toFixed(1)} ${units[i]}`;
}

type FileCategory = "app" | "video" | "audio" | "image" | "pdf" | "archive" | "doc" | "sheet" | "code" | "icloud" | "folder" | "file";

function getCategory(name: string, isIcloud: boolean): FileCategory {
    if (isIcloud) return "icloud";
    const ext = name.split(".").pop()?.toLowerCase() ?? "";
    if (!ext || ext === name.toLowerCase()) return "folder";
    if (ext === "app") return "app";
    if (["mp4","mov","mkv","avi","m4v","wmv","webm"].includes(ext)) return "video";
    if (["mp3","m4a","flac","wav","aac","ogg","opus"].includes(ext)) return "audio";
    if (["jpg","jpeg","png","gif","webp","heic","tiff","bmp","svg","raw","cr2"].includes(ext)) return "image";
    if (ext === "pdf") return "pdf";
    if (["zip","rar","7z","tar","gz","bz2","xz","dmg","pkg"].includes(ext)) return "archive";
    if (["doc","docx","pages","txt","rtf","md"].includes(ext)) return "doc";
    if (["xls","xlsx","numbers","csv"].includes(ext)) return "sheet";
    if (["js","ts","tsx","jsx","py","rb","go","rs","cpp","c","h","json","yaml","toml","sh"].includes(ext)) return "code";
    return "file";
}

const ICON_COLORS: Record<FileCategory, { bg: string; border: string; color: string }> = {
    app:     { bg: "rgba(245,237,214,0.1)",  border: "rgba(245,237,214,0.22)",  color: "#F5EDD6" },
    video:   { bg: "rgba(200,90,70,0.12)",   border: "rgba(200,90,70,0.28)",    color: "rgba(220,110,90,0.9)" },
    audio:   { bg: "rgba(245,237,214,0.08)", border: "rgba(245,237,214,0.18)",  color: "rgba(245,237,214,0.6)" },
    image:   { bg: "rgba(245,237,214,0.1)",  border: "rgba(245,237,214,0.22)",  color: "#F5EDD6" },
    pdf:     { bg: "rgba(200,80,80,0.10)",   border: "rgba(200,80,80,0.25)",    color: "rgba(210,90,90,0.9)" },
    archive: { bg: "rgba(245,237,214,0.1)",  border: "rgba(245,237,214,0.22)",  color: "rgba(245,237,214,0.7)" },
    doc:     { bg: "rgba(245,237,214,0.08)", border: "rgba(245,237,214,0.18)",  color: "rgba(245,237,214,0.55)" },
    sheet:   { bg: "rgba(245,237,214,0.08)", border: "rgba(245,237,214,0.18)",  color: "rgba(245,237,214,0.65)" },
    code:    { bg: "rgba(245,237,214,0.06)", border: "rgba(245,237,214,0.14)",  color: "rgba(245,237,214,0.45)" },
    icloud:  { bg: "rgba(245,237,214,0.07)", border: "rgba(245,237,214,0.16)",  color: "rgba(245,237,214,0.5)" },
    folder:  { bg: "rgba(245,237,214,0.1)",  border: "rgba(245,237,214,0.2)",   color: "#F5EDD6" },
    file:    { bg: "rgba(255,255,255,0.04)", border: "rgba(255,255,255,0.08)",  color: "rgba(245,237,214,0.3)" },
};

function FileIcon({ name, isIcloud }: { name: string; isIcloud: boolean }) {
    const cat = getCategory(name, isIcloud);
    const { bg, border, color } = ICON_COLORS[cat];
    return (
        <div style={{ width: 32, height: 32, borderRadius: 8, flexShrink: 0, background: bg, border: `1px solid ${border}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
                {cat === "icloud"  && <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>}
                {cat === "app"     && <><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></>}
                {cat === "video"   && <><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></>}
                {cat === "audio"   && <><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></>}
                {cat === "image"   && <><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></>}
                {cat === "pdf"     && <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="12" y2="17"/></>}
                {cat === "archive" && <><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></>}
                {cat === "doc"     && <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></>}
                {cat === "sheet"   && <><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></>}
                {cat === "code"    && <><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></>}
                {cat === "folder"  && <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>}
                {cat === "file"    && <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></>}
            </svg>
        </div>
    );
}

function LazyIcon({ item }: { item: TrashItem }) {
    const [thumbSrc, setThumbSrc] = useState<string | null>(null);

    useEffect(() => {
        if (item.is_icloud) return;
        let active = true;
        invoke<string>("get_trash_item_icon", { path: item.path }).then(p => {
            if (active && p) setThumbSrc(convertFileSrc(p));
        }).catch(() => {});
        return () => { active = false; };
    }, [item.path, item.is_icloud]);

    if (thumbSrc) {
        return (
            <img
                src={thumbSrc} alt={item.name}
                onError={() => setThumbSrc(null)}
                style={{ width: 32, height: 32, borderRadius: 8, flexShrink: 0, objectFit: "cover" }}
            />
        );
    }
    return <FileIcon name={item.name} isIcloud={item.is_icloud} />;
}

function RowSkeleton() {
    return (
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", borderBottom: "1px solid rgba(245,237,214,0.06)" }}>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 5 }}>
                <div className="shimmer" style={{ width: 200, height: 12, borderRadius: 5 }} />
            </div>
            <div className="shimmer" style={{ width: 48, height: 12, borderRadius: 4 }} />
            <div className="shimmer" style={{ width: 62, height: 26, borderRadius: 99 }} />
        </div>
    );
}

export default function TrashPage() {
    const [_info,      setInfo]      = useState<TrashInfo | null>(null);
    const [items,      setItems]     = useState<(TrashItem & { deleted?: boolean })[]>([]);
    const [loading,    setLoading]   = useState(true);
    const toast = useToast();
    const [emptying,   setEmptying]  = useState(false);
    const [confirming, setConfirming]= useState(false);
    const [deleting,   setDeleting]  = useState<string | null>(null);
    const [restoring,  setRestoring] = useState<string | null>(null);
    const [search,     setSearch]    = useState("");

    const load = async () => {
        setLoading(true);
        try {
            const r = await invoke<TrashInfo>("get_trash_info");
            setInfo(r);
            setItems(r.items.map(i => ({ ...i, deleted: false })));
        } catch (e) { toast.error(String(e)); }
        setLoading(false);
    };

    useEffect(() => { load(); }, []);

    const handleRestore = async (item: TrashItem) => {
        setRestoring(item.path);
        try {
            const msg = await invoke<string>("restore_trash_item", { path: item.path, name: item.name });
            setItems(prev => prev.map(i => i.path === item.path ? { ...i, deleted: true } : i));
            toast.success(msg);
        } catch (e) { toast.error(String(e)); }
        setRestoring(null);
    };

    const handleDelete = async (item: TrashItem) => {
        setDeleting(item.path);
        try {
            await invoke("delete_trash_item", { path: item.path });
            setItems(prev => prev.map(i => i.path === item.path ? { ...i, deleted: true } : i));
        } catch (e) { toast.error(String(e)); }
        setDeleting(null);
    };

    const handleEmpty = async () => {
        setEmptying(true); setConfirming(false);
        try {
            await invoke("empty_trash");
            setItems([]);
            setInfo(i => i ? { ...i, items: [], total_size: 0, total_size_human: "0 B" } : i);
        } catch (e) { toast.error(String(e)); }
        setEmptying(false);
    };

    const live       = items.filter(i => !i.deleted);
    const query      = search.toLowerCase();
    const filtered   = query ? live.filter(i => i.name.toLowerCase().includes(query)) : live;
    const totalSize  = live.reduce((acc, i) => acc + i.size, 0);
    const icloudCount = live.filter(i => i.is_icloud).length;

    return (
        <div className="fade-in" style={{ padding: "24px 28px 20px", display: "flex", flexDirection: "column", gap: 12, height: "calc(100vh - 48px)", boxSizing: "border-box" }}>

            {/* Page title */}
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, color: "#F5EDD6", fontFamily: "'New York', 'Iowan Old Style', Georgia, serif", letterSpacing: "-0.02em", flexShrink: 0 }}>
                Çöp Kutusu
            </h1>

            {/* Summary bar */}
            <div style={{
                borderRadius: 14, padding: "14px 18px",
                display: "flex", alignItems: "center", justifyContent: "space-between",
                flexShrink: 0,
                background: "rgba(245,237,214,0.06)",
                border: "1px solid rgba(245,237,214,0.14)",
            }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    {loading ? (
                        <div className="shimmer" style={{ width: 120, height: 28, borderRadius: 6 }} />
                    ) : (
                        <span style={{
                            fontSize: 28, fontWeight: 800, letterSpacing: "-0.03em",
                            fontFamily: "'New York', 'Iowan Old Style', Georgia, serif",
                            color: "#F5EDD6",
                        }}>
                            {live.length > 0 ? humanizeBytes(totalSize) : "Tertemiz"}
                        </span>
                    )}
                    {!loading && (
                        <span style={{ fontSize: 11, color: "rgba(245,237,214,0.32)" }}>
                            {live.length} öğe
                            {icloudCount > 0 && ` · ${icloudCount} iCloud'da`}
                        </span>
                    )}
                </div>

                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <button
                        onClick={load} disabled={loading}
                        style={{
                            padding: "7px 14px", fontSize: 12,
                            color: "rgba(245,237,214,0.4)",
                            background: "rgba(245,237,214,0.05)",
                            border: "1px solid rgba(245,237,214,0.12)",
                            borderRadius: 99, cursor: loading ? "not-allowed" : "pointer",
                            transition: "all 0.15s",
                        }}
                        onMouseEnter={e => { if (!loading) e.currentTarget.style.background = "rgba(245,237,214,0.1)"; }}
                        onMouseLeave={e => { e.currentTarget.style.background = "rgba(245,237,214,0.05)"; }}
                    >
                        Yenile
                    </button>

                    {live.length > 0 && !confirming && (
                        <button
                            onClick={() => setConfirming(true)} disabled={emptying || loading}
                            style={{
                                padding: "7px 18px", fontSize: 12, fontWeight: 700,
                                color: emptying ? "rgba(245,237,214,0.3)" : "#150b00",
                                background: emptying ? "rgba(245,237,214,0.07)" : "#F5EDD6",
                                border: "1px solid rgba(245,237,214,0.45)",
                                borderRadius: 99, cursor: emptying ? "not-allowed" : "pointer",
                                transition: "all 0.15s",
                            }}
                            onMouseEnter={e => { if (!emptying) e.currentTarget.style.background = "rgba(245,237,214,0.82)"; }}
                            onMouseLeave={e => { e.currentTarget.style.background = emptying ? "rgba(245,237,214,0.07)" : "#F5EDD6"; }}
                        >
                            {emptying ? "Boşaltılıyor…" : "Çöp Kutusunu Boşalt"}
                        </button>
                    )}

                    {live.length > 0 && confirming && (
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ fontSize: 11, color: "rgba(245,237,214,0.38)", whiteSpace: "nowrap" }}>Emin misin?</span>
                            <button
                                onClick={handleEmpty}
                                style={{
                                    padding: "7px 14px", fontSize: 12, fontWeight: 600,
                                    color: "#F5EDD6", background: "rgba(200,80,80,0.22)",
                                    border: "1px solid rgba(200,80,80,0.45)",
                                    borderRadius: 99, cursor: "pointer", transition: "all 0.15s",
                                }}
                                onMouseEnter={e => { e.currentTarget.style.background = "rgba(200,80,80,0.38)"; }}
                                onMouseLeave={e => { e.currentTarget.style.background = "rgba(200,80,80,0.22)"; }}
                            >
                                Evet, Boşalt
                            </button>
                            <button
                                onClick={() => setConfirming(false)}
                                style={{
                                    padding: "7px 12px", fontSize: 12,
                                    color: "rgba(245,237,214,0.38)",
                                    background: "transparent",
                                    border: "1px solid rgba(245,237,214,0.12)",
                                    borderRadius: 99, cursor: "pointer",
                                }}
                            >
                                Vazgeç
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* Search */}
            {!loading && live.length > 5 && (
                <input
                    type="text" value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Öğe ara…"
                    style={{
                        padding: "8px 14px", flexShrink: 0,
                        background: "rgba(245,237,214,0.04)",
                        border: "1px solid rgba(245,237,214,0.11)",
                        borderRadius: 10, fontSize: 13, color: "#F5EDD6",
                        outline: "none", transition: "border-color 0.15s",
                    }}
                    onFocus={e => (e.currentTarget.style.borderColor = "rgba(245,237,214,0.4)")}
                    onBlur={e  => (e.currentTarget.style.borderColor = "rgba(245,237,214,0.11)")}
                />
            )}

            {/* List */}
            <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
                {loading ? (
                    <div style={{ ...card, borderRadius: 14, overflow: "hidden" }}>
                        {Array.from({ length: 8 }).map((_, i) => <RowSkeleton key={i} />)}
                    </div>
                ) : filtered.length === 0 && live.length === 0 ? (
                    <div style={{ textAlign: "center", paddingTop: 60 }}>
                        <p style={{ fontSize: 18, fontWeight: 700, fontFamily: "'New York', 'Iowan Old Style', Georgia, serif", color: "rgba(245,237,214,0.45)", margin: "0 0 8px" }}>Çöp kutusu boş</p>
                        <p style={{ fontSize: 12, color: "rgba(245,237,214,0.22)", margin: 0 }}>Silinecek bir şey yok</p>
                    </div>
                ) : filtered.length === 0 ? (
                    <div style={{ textAlign: "center", paddingTop: 60, fontSize: 14, fontFamily: "'New York', 'Iowan Old Style', Georgia, serif", color: "rgba(245,237,214,0.3)" }}>
                        "{search}" ile eşleşen öğe yok
                    </div>
                ) : (
                    <div style={{ ...card, borderRadius: 14, overflow: "hidden" }}>
                        {filtered.map((item, i) => (
                            <div
                                key={item.path}
                                style={{
                                    display: "flex", alignItems: "center", gap: 12,
                                    padding: "10px 16px",
                                    borderBottom: i < filtered.length - 1 ? "1px solid rgba(245,237,214,0.06)" : "none",
                                    transition: "background 0.12s",
                                }}
                                onMouseEnter={e => ((e.currentTarget as HTMLElement).style.background = "rgba(245,237,214,0.03)")}
                                onMouseLeave={e => ((e.currentTarget as HTMLElement).style.background = "transparent")}
                            >
                                <LazyIcon item={item} />

                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: 13, fontWeight: 500, color: "#F5EDD6", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                        {item.name}
                                    </div>
                                </div>

                                <span style={{ fontSize: 11, flexShrink: 0, color: "rgba(245,237,214,0.35)", fontVariantNumeric: "tabular-nums" }}>
                                    {item.size_human}
                                </span>

                                {/* Restore */}
                                {!item.is_icloud && (
                                    <button
                                        onClick={() => handleRestore(item)}
                                        disabled={restoring === item.path || deleting === item.path}
                                        style={{
                                            padding: "4px 12px", fontSize: 11, flexShrink: 0,
                                            color: restoring === item.path ? "rgba(245,237,214,0.2)" : "rgba(245,237,214,0.7)",
                                            background: "transparent",
                                            border: `1px solid ${restoring === item.path ? "rgba(245,237,214,0.06)" : "rgba(245,237,214,0.28)"}`,
                                            borderRadius: 99, cursor: restoring === item.path ? "not-allowed" : "pointer",
                                            transition: "all 0.12s",
                                        }}
                                        onMouseEnter={e => { if (restoring !== item.path) { e.currentTarget.style.background = "rgba(245,237,214,0.1)"; e.currentTarget.style.borderColor = "rgba(245,237,214,0.5)"; }}}
                                        onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = restoring === item.path ? "rgba(245,237,214,0.06)" : "rgba(245,237,214,0.28)"; }}
                                    >
                                        {restoring === item.path ? "…" : "Geri Yükle"}
                                    </button>
                                )}

                                {/* Delete */}
                                <button
                                    onClick={() => handleDelete(item)}
                                    disabled={deleting === item.path || restoring === item.path}
                                    style={{
                                        padding: "4px 12px", fontSize: 11, flexShrink: 0,
                                        color: deleting === item.path ? "rgba(245,237,214,0.2)" : "rgba(210,90,90,0.9)",
                                        background: "transparent",
                                        border: `1px solid ${deleting === item.path ? "rgba(245,237,214,0.06)" : "rgba(200,80,80,0.28)"}`,
                                        borderRadius: 99, cursor: deleting === item.path ? "not-allowed" : "pointer",
                                        transition: "all 0.12s",
                                    }}
                                    onMouseEnter={e => { if (deleting !== item.path) { e.currentTarget.style.background = "rgba(200,80,80,0.1)"; e.currentTarget.style.borderColor = "rgba(200,80,80,0.5)"; }}}
                                    onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = deleting === item.path ? "rgba(245,237,214,0.06)" : "rgba(200,80,80,0.28)"; }}
                                >
                                    {deleting === item.path ? "…" : "Sil"}
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
