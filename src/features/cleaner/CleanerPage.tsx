import { useState, useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useNavigate, useLocation } from "react-router-dom";
import { useToast } from "../../shared/store/toastStore";
import { useAppStore } from "../../shared/store";

interface JunkItem     { name: string; path: string; size: number; size_human: string }
interface JunkCategory { id: string; name: string; description: string; size: number; size_human: string; items: JunkItem[] }
interface JunkScanDone { total_size: number; total_size_human: string }

const SAFE_IDS   = new Set(["caches","browsers","logs","dev","trash","ios","diagnostics","saved_states","snapshots"]);
const TOTAL_CATS = 12;

function humanize(b: number) {
    if (b === 0) return "0 B";
    const u = ["B", "KB", "MB", "GB", "TB"];
    let i = 0, s = b;
    while (s >= 1024 && i < u.length - 1) { s /= 1024; i++; }
    return i === 0 ? `${b} B` : `${s.toFixed(1)} ${u[i]}`;
}

// ── Checkbox ──────────────────────────────────────────────────────────────────

function Checkbox({ checked, indeterminate, onChange }: { checked: boolean; indeterminate?: boolean; onChange: () => void }) {
    const active = checked || indeterminate;
    return (
        <button
            onClick={e => { e.stopPropagation(); onChange(); }}
            style={{
                width: 17, height: 17, borderRadius: 4, flexShrink: 0,
                border: `1.5px solid ${active ? "#F5EDD6" : "rgba(245,237,214,0.14)"}`,
                background: active ? "rgba(245,237,214,0.15)" : "transparent",
                display: "flex", alignItems: "center", justifyContent: "center",
                cursor: "pointer", transition: "all 0.15s", padding: 0,
            }}
        >
            {checked && !indeterminate && (
                <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
                    <path d="M1.5 5L4 7.5L8.5 2.5" stroke="#F5EDD6" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
            )}
            {indeterminate && (
                <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
                    <path d="M2 5h6" stroke="#F5EDD6" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
            )}
        </button>
    );
}

// ── Reveal button ─────────────────────────────────────────────────────────────

function RevealButton({ path }: { path: string }) {
    return (
        <button
            title="Finder'da göster"
            onClick={e => { e.stopPropagation(); invoke("reveal_in_finder", { path }).catch(() => {}); }}
            style={{
                flexShrink: 0, background: "transparent", border: "none",
                padding: "2px 4px", cursor: "pointer", opacity: 0.3,
                display: "flex", alignItems: "center", transition: "opacity 0.15s",
            }}
            onMouseEnter={e => { e.currentTarget.style.opacity = "0.8"; }}
            onMouseLeave={e => { e.currentTarget.style.opacity = "0.3"; }}
        >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#F5EDD6" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 7C3 5.9 3.9 5 5 5h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/>
            </svg>
        </button>
    );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function SkeletonCard() {
    return (
        <div style={{
            background: "rgba(245,237,214,0.02)", border: "1px solid rgba(245,237,214,0.06)",
            borderRadius: 12, padding: "14px 16px", display: "flex", alignItems: "center", gap: 12,
        }}>
            <div className="shimmer" style={{ width: 16, height: 16, borderRadius: 4 }} />
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <div className="shimmer" style={{ width: 130, height: 12, borderRadius: 4 }} />
                    <div className="shimmer" style={{ width: 44, height: 12, borderRadius: 4 }} />
                </div>
                <div className="shimmer" style={{ width: "100%", height: 3, borderRadius: 99 }} />
                <div className="shimmer" style={{ width: 180, height: 10, borderRadius: 4 }} />
            </div>
        </div>
    );
}

// ── Category card ─────────────────────────────────────────────────────────────

function CategoryCard({
    cat, checkedPaths, onToggleAll, onToggleItem, totalSize, animationDelay,
}: {
    cat: JunkCategory;
    checkedPaths: Set<string>;
    onToggleAll: () => void;
    onToggleItem: (path: string) => void;
    totalSize: number;
    animationDelay: number;
}) {
    const [open, setOpen] = useState(false);
    const pct = totalSize > 0 && cat.size > 0 ? Math.min(100, (cat.size / totalSize) * 100) : 0;

    const allChecked    = cat.items.length > 0 && cat.items.every(i => checkedPaths.has(i.path));
    const someChecked   = cat.items.some(i => checkedPaths.has(i.path));
    const indeterminate = someChecked && !allChecked;
    const anyActive     = allChecked || someChecked;
    const selectedSize  = cat.items.filter(i => checkedPaths.has(i.path)).reduce((s, i) => s + i.size, 0);
    const isReview      = !SAFE_IDS.has(cat.id);

    return (
        <div style={{
            background: anyActive ? "rgba(245,237,214,0.04)" : "rgba(245,237,214,0.02)",
            border: `1px solid ${anyActive ? "rgba(245,237,214,0.18)" : "rgba(245,237,214,0.07)"}`,
            borderRadius: 12, overflow: "hidden",
            transition: "border-color 0.15s, background 0.15s",
            animation: `catSlideIn 0.32s ease-out ${animationDelay}ms both`,
        }}>
            <button
                style={{
                    width: "100%", background: "transparent", border: "none",
                    padding: "12px 16px", display: "flex", alignItems: "center",
                    gap: 12, cursor: "pointer", textAlign: "left", transition: "background 0.15s",
                }}
                onMouseEnter={e => { e.currentTarget.style.background = "rgba(245,237,214,0.03)"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
                onClick={() => setOpen(o => !o)}
            >
                <Checkbox checked={allChecked} indeterminate={indeterminate} onChange={onToggleAll} />

                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 7, gap: 8 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                            <span style={{
                                fontSize: 13, fontWeight: 600,
                                color: anyActive ? "#F5EDD6" : "rgba(245,237,214,0.38)",
                                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                                transition: "color 0.15s",
                            }}>
                                {cat.name}
                            </span>
                            {isReview && (
                                <span style={{
                                    flexShrink: 0, fontSize: 9, fontWeight: 700, letterSpacing: "0.1em",
                                    color: "rgba(245,237,214,0.7)", background: "rgba(245,237,214,0.08)",
                                    border: "1px solid rgba(245,237,214,0.18)",
                                    padding: "1px 5px", borderRadius: 4,
                                }}>
                                    İNCELE
                                </span>
                            )}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                            {someChecked && selectedSize !== cat.size && (
                                <span style={{ fontSize: 11, fontFamily: "monospace", color: "rgba(245,237,214,0.7)", whiteSpace: "nowrap" }}>
                                    {humanize(selectedSize)}
                                </span>
                            )}
                            <span style={{
                                fontSize: 13, fontFamily: "monospace", fontWeight: 700,
                                color: anyActive ? "rgba(245,237,214,0.85)" : "rgba(245,237,214,0.18)",
                                whiteSpace: "nowrap", transition: "color 0.15s",
                            }}>
                                {cat.size_human}
                            </span>
                        </div>
                    </div>

                    <div style={{ width: "100%", background: "rgba(245,237,214,0.05)", borderRadius: 99, height: 3, overflow: "hidden" }}>
                        <div style={{
                            height: 3, borderRadius: 99, width: `${pct}%`,
                            background: anyActive ? "rgba(245,237,214,0.85)" : "rgba(245,237,214,0.08)",
                            transition: "width 0.6s ease, background 0.2s",
                        }} />
                    </div>

                    <p style={{ fontSize: 11, color: "rgba(245,237,214,0.22)", marginTop: 5, marginBottom: 0 }}>
                        {cat.description}
                    </p>
                </div>

                <svg width="12" height="12" fill="none" viewBox="0 0 24 24"
                    stroke="rgba(245,237,214,0.22)" strokeWidth={2}
                    style={{ flexShrink: 0, transition: "transform 0.2s", transform: open ? "rotate(180deg)" : "rotate(0deg)" }}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
            </button>

            {open && (
                <div style={{ borderTop: "1px solid rgba(245,237,214,0.06)" }}>
                    {cat.items.length === 0
                        ? <p style={{ padding: "10px 16px", fontSize: 11, color: "rgba(245,237,214,0.2)", margin: 0 }}>Bulunamadı</p>
                        : cat.items.map((item, i) => {
                            const itemChecked = checkedPaths.has(item.path);
                            return (
                                <div
                                    key={item.path}
                                    onClick={() => onToggleItem(item.path)}
                                    style={{
                                        display: "flex", alignItems: "center", gap: 10,
                                        padding: "7px 16px", cursor: "pointer",
                                        borderBottom: i < cat.items.length - 1 ? "1px solid rgba(245,237,214,0.04)" : "none",
                                        transition: "background 0.12s",
                                    }}
                                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(245,237,214,0.03)"; }}
                                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                                >
                                    <Checkbox checked={itemChecked} onChange={() => onToggleItem(item.path)} />
                                    <div style={{ minWidth: 0, flex: 1 }}>
                                        <div style={{
                                            fontSize: 12, fontWeight: 500,
                                            color: itemChecked ? "rgba(245,237,214,0.75)" : "rgba(245,237,214,0.28)",
                                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                                            transition: "color 0.15s",
                                        }}>
                                            {item.name}
                                        </div>
                                        <div style={{ fontSize: 10, color: "rgba(245,237,214,0.14)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                            {item.path}
                                        </div>
                                    </div>
                                    <RevealButton path={item.path} />
                                    <span style={{
                                        fontSize: 11, fontFamily: "monospace", flexShrink: 0,
                                        color: itemChecked ? "rgba(245,237,214,0.45)" : "rgba(245,237,214,0.16)",
                                        transition: "color 0.15s",
                                    }}>
                                        {item.size_human}
                                    </span>
                                </div>
                            );
                        })
                    }
                </div>
            )}
        </div>
    );
}

// ── Confirm modal ─────────────────────────────────────────────────────────────

function ConfirmModal({
    categories, onConfirm, onCancel,
}: {
    categories: { id: string; name: string; count: number; size: number; size_human: string }[];
    onConfirm: () => void;
    onCancel: () => void;
}) {
    const total = categories.reduce((s, c) => s + c.size, 0);

    return createPortal(
        <div style={{
            position: "fixed", inset: 0, zIndex: 9999,
            background: "rgba(0,0,0,0.65)", backdropFilter: "blur(10px)",
            display: "flex", alignItems: "center", justifyContent: "center",
        }}>
            <div style={{
                background: "#1a0e00",
                border: "1px solid rgba(245,237,214,0.2)",
                borderRadius: 18, padding: "26px 28px",
                width: 380, maxWidth: "90vw",
                display: "flex", flexDirection: "column", gap: 16,
            }}>
                <div>
                    <p style={{
                        margin: "0 0 5px",
                        fontFamily: "'New York', 'Iowan Old Style', Georgia, serif",
                        fontSize: 22, fontWeight: 900, color: "#F5EDD6", letterSpacing: "-0.02em",
                    }}>
                        {humanize(total)} silinsin mi?
                    </p>
                    <p style={{ margin: 0, fontSize: 12, color: "rgba(245,237,214,0.3)" }}>
                        Aşağıdaki dosyalar kalıcı olarak silinecek:
                    </p>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 5, maxHeight: 200, overflowY: "auto" }}>
                    {categories.map(c => (
                        <div key={c.id} style={{
                            display: "flex", justifyContent: "space-between", alignItems: "center",
                            padding: "7px 10px",
                            background: "rgba(245,237,214,0.03)",
                            borderRadius: 8, border: "1px solid rgba(245,237,214,0.08)",
                        }}>
                            <div>
                                <span style={{ fontSize: 12, color: "rgba(245,237,214,0.65)" }}>{c.name}</span>
                                <span style={{ fontSize: 10, color: "rgba(245,237,214,0.2)", marginLeft: 6 }}>{c.count} dosya</span>
                            </div>
                            <span style={{ fontSize: 12, fontFamily: "monospace", color: "rgba(245,237,214,0.7)" }}>{c.size_human}</span>
                        </div>
                    ))}
                </div>

                <p style={{ margin: 0, fontSize: 11, color: "rgba(245,237,214,0.18)" }}>
                    Bu işlem geri alınamaz.
                </p>

                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                    <button
                        onClick={onCancel}
                        style={{
                            padding: "8px 18px", fontSize: 13, fontWeight: 500,
                            color: "rgba(245,237,214,0.4)",
                            background: "transparent",
                            border: "1px solid rgba(245,237,214,0.1)",
                            borderRadius: 99, cursor: "pointer", transition: "all 0.15s",
                        }}
                        onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(245,237,214,0.22)"; e.currentTarget.style.color = "rgba(245,237,214,0.65)"; }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(245,237,214,0.1)"; e.currentTarget.style.color = "rgba(245,237,214,0.4)"; }}
                    >
                        Vazgeç
                    </button>
                    <button
                        onClick={onConfirm}
                        style={{
                            padding: "8px 22px", fontSize: 13, fontWeight: 700,
                            color: "#150b00", background: "#F5EDD6",
                            border: "1px solid rgba(245,237,214,0.45)",
                            borderRadius: 99, cursor: "pointer", transition: "all 0.15s",
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = "rgba(245,237,214,0.82)"; }}
                        onMouseLeave={e => { e.currentTarget.style.background = "#F5EDD6"; }}
                    >
                        Sil
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CleanerPage() {
    const navigate = useNavigate();
    const location = useLocation();
    const { fetchSystemStatus } = useAppStore();
    const [categories,   setCategories]   = useState<JunkCategory[]>([]);
    const [totalSize,    setTotalSize]    = useState(0);
    const [checkedItems, setCheckedItems] = useState<Record<string, Set<string>>>({});
    const toast = useToast();
    const [scanning,   setScanning]   = useState(false);
    const [scanCount,  setScanCount]  = useState(0);
    const [cleaning,   setCleaning]   = useState(false);
    const [cleanStatus, setCleanStatus] = useState("");
    const [showModal,  setShowModal]  = useState(false);
    const [freedBytes, setFreedBytes] = useState<number | null>(null);
    const [hasScanned, setHasScanned] = useState(false);

    const unlistenRef = useRef<Array<() => void>>([]);

    const scan = useCallback(async (force = false) => {
        unlistenRef.current.forEach(u => u());
        unlistenRef.current = [];
        setScanning(true);
        setCategories([]);
        setScanCount(0);
        setTotalSize(0);

        const ul1 = await listen<JunkCategory>("junk_category", event => {
            const cat = event.payload;
            setCategories(prev => [...prev, cat]);
            setScanCount(prev => prev + 1);
            setCheckedItems(prev => ({
                ...prev,
                [cat.id]: SAFE_IDS.has(cat.id)
                    ? new Set(cat.items.map(i => i.path))
                    : new Set<string>(),
            }));
        });

        const ul2 = await listen<JunkScanDone>("junk_scan_done", event => {
            setTotalSize(event.payload.total_size);
            setScanning(false);
            setHasScanned(true);
            unlistenRef.current.forEach(u => u());
            unlistenRef.current = [];
        });

        unlistenRef.current = [ul1, ul2];

        try {
            await invoke("scan_junk_streaming", { force });
        } catch (e) {
            toast.error(String(e));
            setScanning(false);
            unlistenRef.current.forEach(u => u());
            unlistenRef.current = [];
        }
    }, []);

    useEffect(() => () => { unlistenRef.current.forEach(u => u()); }, []);
    const autoScannedRef = useRef(false);
    useEffect(() => {
        if ((location.state as any)?.autoScan && !autoScannedRef.current) {
            autoScannedRef.current = true;
            scan(true);
        }
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Derived values ────────────────────────────────────────────────────────
    const checkedSize = categories.reduce((total, cat) => {
        const paths = checkedItems[cat.id] ?? new Set<string>();
        return total + cat.items.filter(i => paths.has(i.path)).reduce((s, i) => s + i.size, 0);
    }, 0);

    const totalItemCount    = categories.reduce((s, c) => s + c.items.length, 0);
    const selectedItemCount = categories.reduce((s, cat) => {
        return s + cat.items.filter(i => (checkedItems[cat.id] ?? new Set<string>()).has(i.path)).length;
    }, 0);
    const allSelected = totalItemCount > 0 && selectedItemCount === totalItemCount;

    const toggleAll = () => {
        const next: Record<string, Set<string>> = {};
        for (const cat of categories) {
            next[cat.id] = allSelected ? new Set() : new Set(cat.items.map(i => i.path));
        }
        setCheckedItems(next);
    };

    const toggleCategory = useCallback((catId: string, items: JunkItem[]) => {
        setCheckedItems(prev => {
            const current = prev[catId] ?? new Set<string>();
            const allPaths = items.map(i => i.path);
            const allChecked = allPaths.length > 0 && allPaths.every(p => current.has(p));
            return { ...prev, [catId]: allChecked ? new Set() : new Set(allPaths) };
        });
    }, []);

    const toggleItem = useCallback((catId: string, path: string) => {
        setCheckedItems(prev => {
            const current = new Set<string>(prev[catId] ?? []);
            if (current.has(path)) current.delete(path); else current.add(path);
            return { ...prev, [catId]: current };
        });
    }, []);

    const modalCategories = categories.flatMap(cat => {
        const paths = checkedItems[cat.id] ?? new Set<string>();
        const selected = cat.items.filter(i => paths.has(i.path));
        if (selected.length === 0) return [];
        const size = selected.reduce((s, i) => s + i.size, 0);
        return [{ id: cat.id, name: cat.name, count: selected.length, size, size_human: humanize(size) }];
    });

    const performClean = async () => {
        setShowModal(false);
        const sizeBefore = checkedSize;

        const regularPaths: string[] = [];
        let snapshotNames: string[] = [];
        let includesTrash = false;

        for (const cat of categories) {
            const paths = checkedItems[cat.id] ?? new Set<string>();
            const selected = cat.items.filter(i => paths.has(i.path)).map(i => i.path);
            if (selected.length === 0) continue;
            if (cat.id === "snapshots") snapshotNames = selected;
            else if (cat.id === "trash")  includesTrash = true;
            else                          regularPaths.push(...selected);
        }

        // Pre-authenticate if anything might need admin — shows ONE password dialog
        // upfront, before any cleaning UI appears. macOS caches the credential for
        // ~5 minutes so subsequent osascript calls won't re-prompt.
        const needsAdmin = regularPaths.length > 0 || snapshotNames.length > 0;
        if (needsAdmin) {
            try {
                await invoke("request_admin_auth");
            } catch {
                return; // user cancelled — do nothing
            }
        }

        // Password obtained (or not needed) — now show cleaning state
        setCleaning(true);
        setCleanStatus("Temizleniyor…");

        if (snapshotNames.length > 0) {
            setCleanStatus("Anlık görüntüler siliniyor…");
            try { await invoke<string>("delete_apfs_snapshots", { names: snapshotNames }); }
            catch (e) { toast.error(`Snapshots: ${String(e)}`); }
        }
        if (includesTrash) {
            setCleanStatus("Çöp kutusu boşaltılıyor…");
            try { await invoke<void>("empty_trash"); }
            catch (e) { toast.error(`Çöp kutusu: ${String(e)}`); }
        }
        if (regularPaths.length > 0) {
            setCleanStatus("Dosyalar siliniyor…");
            try { await invoke<string>("clean_junk_paths", { paths: regularPaths }); }
            catch (e) { toast.error(`Temizlik: ${String(e)}`); }
        }

        setCleanStatus("Tamamlandı");
        setCleaning(false);
        setFreedBytes(sizeBefore);
        fetchSystemStatus(true);
        setCategories([]);
        setCheckedItems({});
        setHasScanned(false);
        setTimeout(() => navigate("/"), 2200);
    };

    const isRunning = scanning || cleaning;
    const canClean  = !isRunning && checkedSize > 0;

    const safeCategories   = categories.filter(c =>  SAFE_IDS.has(c.id));
    const reviewCategories = categories.filter(c => !SAFE_IDS.has(c.id));
    const skeletonCount    = scanning ? Math.max(0, Math.min(3, TOTAL_CATS - scanCount)) : 0;

    return (
        <div style={{ padding: "28px 28px 32px", display: "flex", flexDirection: "column", gap: 0 }}>
            <style>{`
                @keyframes spin          { to { transform: rotate(360deg) } }
                @keyframes catSlideIn    { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
                @keyframes ringDraw      { to { stroke-dashoffset: 0 } }
                @keyframes checkDraw     { to { stroke-dashoffset: 0 } }
                @keyframes successFadeIn { from { opacity: 0 } to { opacity: 1 } }
                @keyframes successPopIn  { from { opacity: 0; transform: scale(0.75) } to { opacity: 1; transform: scale(1) } }
                .shimmer { background: linear-gradient(90deg, rgba(245,237,214,0.04) 25%, rgba(245,237,214,0.08) 50%, rgba(245,237,214,0.04) 75%); background-size: 200% 100%; animation: shimmer 1.4s infinite; border-radius: 4px; }
                @keyframes shimmer { to { background-position: -200% 0 } }
            `}</style>

            {/* ── Header ───────────────────────────────────────────────────── */}
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24 }}>
                <div>
                    <h1 style={{
                        margin: "0 0 4px",
                        fontFamily: "'New York', 'Iowan Old Style', Georgia, serif",
                        fontSize: 28, fontWeight: 900, color: "#F5EDD6", letterSpacing: "-0.03em",
                    }}>
                        Temizleyici
                    </h1>
                    <p style={{ margin: 0, fontSize: 12, color: "rgba(245,237,214,0.28)", lineHeight: 1.5 }}>
                        {scanning
                            ? `${scanCount} / ${TOTAL_CATS} kategori tarandı`
                            : "Önbellek, tarayıcı ve geçici dosyaları temizleyin"
                        }
                    </p>
                </div>

                <div style={{ display: "flex", gap: 8, alignItems: "center", paddingTop: 4 }}>
                    {/* Scan button */}
                    <button
                        onClick={() => scan(!!hasScanned)} disabled={isRunning}
                        style={{
                            display: "flex", alignItems: "center", gap: 7,
                            padding: "7px 16px", fontSize: 12, fontWeight: 600, letterSpacing: "0.02em",
                            color: isRunning ? "rgba(245,237,214,0.2)" : "rgba(245,237,214,0.7)",
                            background: "transparent",
                            border: `1px solid ${isRunning ? "rgba(245,237,214,0.07)" : "rgba(245,237,214,0.22)"}`,
                            borderRadius: 99, cursor: isRunning ? "not-allowed" : "pointer", transition: "all 0.15s",
                        }}
                        onMouseEnter={e => { if (!isRunning) { e.currentTarget.style.background = "rgba(245,237,214,0.06)"; e.currentTarget.style.borderColor = "rgba(245,237,214,0.4)"; } }}
                        onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = isRunning ? "rgba(245,237,214,0.07)" : "rgba(245,237,214,0.22)"; }}
                    >
                        {scanning && (
                            <span style={{
                                width: 10, height: 10, flexShrink: 0,
                                border: "1.5px solid rgba(245,237,214,0.2)", borderTopColor: "rgba(245,237,214,0.85)",
                                borderRadius: "50%", display: "inline-block",
                                animation: "spin 0.75s linear infinite",
                            }} />
                        )}
                        {scanning ? "Taranıyor…" : !hasScanned ? "Tara" : "Yeniden Tara"}
                    </button>

                    {/* Clean button */}
                    {(categories.length > 0 || hasScanned) && (
                        <button
                            onClick={() => canClean && setShowModal(true)}
                            disabled={!canClean}
                            style={{
                                padding: "7px 18px", fontSize: 12, fontWeight: 700,
                                color: !canClean ? "rgba(245,237,214,0.18)" : "#150b00",
                                background: !canClean ? "transparent" : "#F5EDD6",
                                border: `1px solid ${!canClean ? "rgba(245,237,214,0.07)" : "rgba(245,237,214,0.45)"}`,
                                borderRadius: 99, cursor: !canClean ? "not-allowed" : "pointer", transition: "all 0.15s",
                            }}
                            onMouseEnter={e => { if (canClean) e.currentTarget.style.background = "rgba(245,237,214,0.82)"; }}
                            onMouseLeave={e => { if (canClean) e.currentTarget.style.background = "#F5EDD6"; }}
                        >
                            {cleaning ? cleanStatus || "Temizleniyor…" : canClean ? `Temizle · ${humanize(checkedSize)}` : "Temizle"}
                        </button>
                    )}
                </div>
            </div>

            {/* ── Select all row ────────────────────────────────────────────── */}
            {categories.length > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                    <button
                        onClick={toggleAll}
                        style={{
                            fontSize: 11, color: "rgba(245,237,214,0.3)",
                            background: "none", border: "none", padding: 0, cursor: "pointer",
                            transition: "color 0.15s",
                        }}
                        onMouseEnter={e => { e.currentTarget.style.color = "rgba(245,237,214,0.6)"; }}
                        onMouseLeave={e => { e.currentTarget.style.color = "rgba(245,237,214,0.3)"; }}
                    >
                        {allSelected ? "Seçimi kaldır" : "Tümünü seç"}
                    </button>
                    <span style={{ fontSize: 11, color: "rgba(245,237,214,0.15)" }}>
                        · {selectedItemCount} / {totalItemCount} dosya seçili
                    </span>
                    {totalSize > 0 && !scanning && (
                        <span style={{ fontSize: 11, color: "rgba(245,237,214,0.15)" }}>
                            · {humanize(totalSize)} toplam
                        </span>
                    )}
                </div>
            )}

            {/* ── Category list ─────────────────────────────────────────────── */}
            {categories.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {safeCategories.length > 0 && (
                        <>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", color: "rgba(245,237,214,0.2)", textTransform: "uppercase" }}>
                                    Güvenle Temizlenebilir
                                </span>
                                <div style={{ flex: 1, height: 1, background: "rgba(245,237,214,0.05)" }} />
                            </div>
                            {safeCategories.map((cat, i) => (
                                <CategoryCard key={cat.id} cat={cat}
                                    checkedPaths={checkedItems[cat.id] ?? new Set()}
                                    onToggleAll={() => toggleCategory(cat.id, cat.items)}
                                    onToggleItem={path => toggleItem(cat.id, path)}
                                    totalSize={totalSize} animationDelay={i * 38} />
                            ))}
                        </>
                    )}

                    {reviewCategories.length > 0 && (
                        <>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, marginBottom: 2 }}>
                                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", color: "rgba(245,237,214,0.35)", textTransform: "uppercase" }}>
                                    Önce İncele
                                </span>
                                <div style={{ flex: 1, height: 1, background: "rgba(245,237,214,0.08)" }} />
                            </div>
                            {reviewCategories.map((cat, i) => (
                                <CategoryCard key={cat.id} cat={cat}
                                    checkedPaths={checkedItems[cat.id] ?? new Set()}
                                    onToggleAll={() => toggleCategory(cat.id, cat.items)}
                                    onToggleItem={path => toggleItem(cat.id, path)}
                                    totalSize={totalSize} animationDelay={i * 38} />
                            ))}
                        </>
                    )}
                </div>
            )}

            {/* Skeleton cards */}
            {skeletonCount > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {Array.from({ length: skeletonCount }).map((_, i) => <SkeletonCard key={i} />)}
                </div>
            )}

            {/* All clean empty state */}
            {!scanning && hasScanned && categories.length === 0 && (
                <div style={{ textAlign: "center", padding: "64px 0" }}>
                    <p style={{
                        fontFamily: "'New York', 'Iowan Old Style', Georgia, serif",
                        fontSize: 22, fontWeight: 900, color: "rgba(245,237,214,0.5)",
                        margin: "0 0 8px", letterSpacing: "-0.02em",
                    }}>
                        Tertemiz
                    </p>
                    <p style={{ fontSize: 12, color: "rgba(245,237,214,0.2)", margin: 0 }}>
                        Mac'inizde temizlenecek bir şey bulunamadı.
                    </p>
                </div>
            )}

            {/* Pre-scan empty state */}
            {!scanning && !hasScanned && categories.length === 0 && (
                <div style={{ textAlign: "center", padding: "72px 0" }}>
                    <p style={{
                        fontFamily: "'New York', 'Iowan Old Style', Georgia, serif",
                        fontSize: 22, fontWeight: 900, color: "rgba(245,237,214,0.18)",
                        margin: "0 0 10px", letterSpacing: "-0.02em",
                    }}>
                        Henüz Taranmadı
                    </p>
                    <p style={{ fontSize: 12, color: "rgba(245,237,214,0.15)", margin: 0 }}>
                        Temizlenebilir dosyaları bulmak için "Tara" düğmesine basın.
                    </p>
                </div>
            )}

            {showModal && (
                <ConfirmModal categories={modalCategories} onConfirm={performClean} onCancel={() => setShowModal(false)} />
            )}

            {/* Success overlay */}
            {freedBytes !== null && createPortal(
                <div style={{
                    position: "fixed", inset: 0, zIndex: 99998,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    background: "rgba(10,5,0,0.72)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)",
                    animation: "successFadeIn 0.3s ease forwards",
                }}>
                    <div style={{
                        display: "flex", flexDirection: "column", alignItems: "center", gap: 20,
                        animation: "successPopIn 0.4s cubic-bezier(0.34,1.56,0.64,1) forwards",
                    }}>
                        <div style={{ position: "relative", width: 96, height: 96 }}>
                            <svg width="96" height="96" viewBox="0 0 100 100" fill="none">
                                <circle cx="50" cy="50" r="44" stroke="rgba(245,237,214,0.1)" strokeWidth="8" />
                                <circle cx="50" cy="50" r="44" stroke="rgba(245,237,214,0.85)" strokeWidth="3"
                                    strokeLinecap="round" strokeDasharray="276.5" strokeDashoffset="276.5"
                                    transform="rotate(-90 50 50)"
                                    style={{ animation: "ringDraw 0.55s ease-out 0.1s forwards" }} />
                                <path d="M28 50L42 64L72 36" stroke="rgba(245,237,214,0.85)" strokeWidth="5"
                                    strokeLinecap="round" strokeLinejoin="round"
                                    strokeDasharray="60" strokeDashoffset="60"
                                    style={{ animation: "checkDraw 0.35s ease-out 0.5s forwards" }} />
                            </svg>
                        </div>
                        <div style={{ textAlign: "center" }}>
                            <p style={{
                                margin: "0 0 6px",
                                fontFamily: "'New York', 'Iowan Old Style', Georgia, serif",
                                fontSize: 28, fontWeight: 900, color: "#F5EDD6", letterSpacing: "-0.03em",
                            }}>
                                {humanize(freedBytes)} temizlendi
                            </p>
                            <p style={{ margin: 0, fontSize: 13, color: "rgba(245,237,214,0.3)" }}>
                                Mac'iniz biraz daha temiz
                            </p>
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
}
