import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useToast } from "../../shared/store/toastStore";

interface PrivacyItem     { name: string; path: string; size: number; size_human: string }
interface PrivacyCategory { id: string; name: string; description: string; size: number; size_human: string; items: PrivacyItem[] }
interface PrivacyReport   { categories: PrivacyCategory[]; total_size: number; total_size_human: string }

const card = { background: "rgba(245,237,214,0.04)", border: "1px solid rgba(245,237,214,0.1)" } as const;

const FILE_CATS = new Set(["browser_history", "browser_cookies", "recent_files", "downloads_history"]);
const TCC_CATS  = new Set(["browser_history", "browser_cookies"]);

// All accent colors unified to the warm palette
const ACCENT: Record<string, string> = {
    browser_history:   "#F5EDD6",
    browser_cookies:   "rgba(245,237,214,0.7)",
    recent_files:      "#F5EDD6",
    downloads_history: "rgba(245,237,214,0.7)",
    dns_cache:         "rgba(245,237,214,0.55)",
    clipboard:         "rgba(245,237,214,0.45)",
};
const DEFAULT_ACCENT = "#F5EDD6";

function Shimmer({ w, h }: { w: number | string; h: number | string }) {
    return <div className="shimmer" style={{ width: w, height: h }} />;
}

function SkeletonCard() {
    return (
        <div style={{ ...card, borderRadius: 14, padding: "14px 16px", display: "flex", alignItems: "center", gap: 12 }}>
            <Shimmer w={10} h={10} />
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <Shimmer w={130} h={13} /><Shimmer w={44} h={13} />
                </div>
                <Shimmer w="100%" h={4} />
                <Shimmer w={180} h={10} />
            </div>
        </div>
    );
}

function CategoryCard({ cat, totalSize, onClean, globalCleaning }: {
    cat: PrivacyCategory; totalSize: number;
    onClean: () => Promise<void>; globalCleaning: boolean;
}) {
    const [open,     setOpen]     = useState(false);
    const [cleaning, setCleaning] = useState(false);
    const [done,     setDone]     = useState(false);
    const [err,      setErr]      = useState<string | null>(null);
    const accent    = ACCENT[cat.id] ?? DEFAULT_ACCENT;
    const pct       = totalSize > 0 && cat.size > 0 ? (cat.size / totalSize) * 100 : 0;
    const isCommand = !FILE_CATS.has(cat.id);
    const busy      = cleaning || globalCleaning;

    const handleClean = async () => {
        setCleaning(true); setErr(null); setDone(false);
        try { await onClean(); setDone(true); }
        catch (e) { setErr(String(e)); }
        setCleaning(false);
    };

    return (
        <div style={{ ...card, borderRadius: 14, overflow: "hidden", transition: "border-color 0.15s" }}>
            <button
                style={{
                    width: "100%", background: "transparent", border: "none",
                    padding: "13px 16px", display: "flex", alignItems: "center",
                    gap: 12, cursor: isCommand ? "default" : "pointer", textAlign: "left",
                    transition: "background 0.15s",
                }}
                onMouseEnter={e => { if (!isCommand) e.currentTarget.style.background = "rgba(245,237,214,0.03)"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
                onClick={() => { if (!isCommand) setOpen(o => !o); }}
            >
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: accent, flexShrink: 0 }} />

                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: isCommand ? 0 : 7 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: "#F5EDD6" }}>{cat.name}</span>
                        {cat.size > 0 && <span style={{ fontSize: 13, fontFamily: "monospace", fontWeight: 700, color: "#F5EDD6" }}>{cat.size_human}</span>}
                    </div>
                    {!isCommand && (
                        <div style={{ width: "100%", background: "rgba(245,237,214,0.08)", borderRadius: 99, height: 4 }}>
                            <div style={{ height: 4, borderRadius: 99, width: `${pct}%`, background: accent, transition: "width 0.6s ease" }} />
                        </div>
                    )}
                    <p style={{ fontSize: 11, color: "rgba(245,237,214,0.32)", marginTop: isCommand ? 4 : 5, marginBottom: 0 }}>{cat.description}</p>
                </div>

                {/* Inline button for command-based categories (DNS, clipboard) */}
                {isCommand && (
                    <button
                        onClick={e => { e.stopPropagation(); handleClean(); }}
                        disabled={busy}
                        style={{
                            padding: "5px 16px", fontSize: 11, fontWeight: 600, flexShrink: 0,
                            color: busy ? "rgba(245,237,214,0.2)" : done ? "rgba(245,237,214,0.7)" : "rgba(245,237,214,0.6)",
                            background: "transparent",
                            border: `1px solid ${busy ? "rgba(245,237,214,0.06)" : done ? "rgba(245,237,214,0.35)" : "rgba(245,237,214,0.16)"}`,
                            borderRadius: 99, cursor: busy ? "not-allowed" : "pointer",
                            transition: "all 0.15s",
                        }}
                        onMouseEnter={e => { if (!busy) e.currentTarget.style.background = "rgba(245,237,214,0.08)"; }}
                        onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
                    >
                        {busy ? "…" : done ? "Temizlendi ✓" : "Temizle"}
                    </button>
                )}

                {!isCommand && (
                    <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="rgba(245,237,214,0.3)" strokeWidth={2}
                        style={{ flexShrink: 0, transition: "transform 0.2s", transform: open ? "rotate(180deg)" : "rotate(0deg)" }}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                )}
            </button>

            {/* Expanded file list */}
            {open && !isCommand && (
                <div style={{ borderTop: "1px solid rgba(245,237,214,0.08)" }}>
                    {cat.items.length > 0 && (
                        <div style={{
                            display: "flex", alignItems: "center", justifyContent: "space-between",
                            padding: "8px 16px", borderBottom: "1px solid rgba(245,237,214,0.06)",
                            background: "rgba(245,237,214,0.03)",
                        }}>
                            <span style={{ fontSize: 11, color: "rgba(245,237,214,0.35)" }}>
                                {err
                                    ? <span style={{ color: "rgba(200,80,80,0.9)" }}>{err}</span>
                                    : done
                                        ? <span style={{ color: "rgba(245,237,214,0.7)" }}>Temizlendi</span>
                                        : `${cat.items.length} öğe`
                                }
                            </span>
                            <button
                                onClick={handleClean} disabled={busy || done}
                                style={{
                                    padding: "4px 14px", fontSize: 11, fontWeight: 600,
                                    color: busy ? "rgba(245,237,214,0.2)" : done ? "rgba(245,237,214,0.7)" : "#150b00",
                                    background: busy ? "rgba(245,237,214,0.05)" : done ? "transparent" : "#F5EDD6",
                                    border: `1px solid ${busy ? "rgba(245,237,214,0.08)" : "rgba(245,237,214,0.4)"}`,
                                    borderRadius: 99, cursor: busy || done ? "not-allowed" : "pointer",
                                    transition: "all 0.15s",
                                }}
                                onMouseEnter={e => { if (!busy && !done) e.currentTarget.style.background = "rgba(245,237,214,0.82)"; }}
                                onMouseLeave={e => { e.currentTarget.style.background = busy ? "rgba(245,237,214,0.05)" : done ? "transparent" : "#F5EDD6"; }}
                            >
                                {busy ? "Temizleniyor…" : done ? "Temizlendi ✓" : "Temizle"}
                            </button>
                        </div>
                    )}
                    {cat.items.length === 0
                        ? <p style={{ padding: "10px 16px", fontSize: 11, color: "rgba(245,237,214,0.28)", margin: 0 }}>Bulunamadı</p>
                        : cat.items.map((item, i) => (
                            <div key={i} style={{
                                display: "flex", alignItems: "center", justifyContent: "space-between",
                                padding: "8px 16px",
                                borderBottom: i < cat.items.length - 1 ? "1px solid rgba(245,237,214,0.06)" : "none",
                            }}>
                                <div style={{ minWidth: 0, flex: 1 }}>
                                    <div style={{ fontSize: 12, fontWeight: 500, color: "rgba(245,237,214,0.75)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                        {item.name}
                                    </div>
                                    <div style={{ fontSize: 10, color: "rgba(245,237,214,0.22)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                        {item.path}
                                    </div>
                                </div>
                                <span style={{ fontSize: 11, fontFamily: "monospace", color: "rgba(245,237,214,0.4)", flexShrink: 0, marginLeft: 12 }}>
                                    {item.size_human}
                                </span>
                            </div>
                        ))
                    }
                </div>
            )}
        </div>
    );
}

export default function PrivacyPage() {
    const toast = useToast();
    const [report,          setReport]          = useState<PrivacyReport | null>(null);
    const [scanning,        setScanning]        = useState(false);
    const [cleaningAll,     setCleaningAll]     = useState(false);
    const [confirmCleanAll, setConfirmCleanAll] = useState(false);
    const [cleanAllMsg,     setCleanAllMsg]     = useState<string | null>(null);

    const scan = useCallback(async () => {
        setScanning(true); setReport(null); setCleanAllMsg(null); setConfirmCleanAll(false);
        try { setReport(await invoke<PrivacyReport>("get_privacy_info")); }
        catch (e) { toast.error(String(e)); }
        setScanning(false);
    }, [toast]);

    const cleanCategory = useCallback(async (cat: PrivacyCategory) => {
        if (cat.id === "dns_cache") {
            await invoke("flush_dns_cache");
        } else if (cat.id === "clipboard") {
            await invoke("clear_clipboard");
        } else {
            const paths = cat.items.map(i => i.path);
            if (paths.length > 0) {
                const result = await invoke<string>("clean_junk_paths", { paths });
                if (TCC_CATS.has(cat.id) && result.startsWith("0 ")) {
                    throw new Error(
                        "macOS erişimi engelledi — Ayarlar'dan Tam Disk Erişimi verin ve tekrar deneyin."
                    );
                }
            }
        }
    }, []);

    const handleCleanAll = async () => {
        if (!report) return;
        setCleaningAll(true); setConfirmCleanAll(false); setCleanAllMsg(null);
        try {
            const allPaths: string[] = [];
            let hasDns = false;
            let hasClipboard = false;

            for (const cat of report.categories) {
                if (FILE_CATS.has(cat.id)) {
                    allPaths.push(...cat.items.map(i => i.path));
                } else if (cat.id === "dns_cache") {
                    hasDns = true;
                } else if (cat.id === "clipboard") {
                    hasClipboard = true;
                }
            }

            if (allPaths.length > 0 || hasDns) {
                const result = await invoke<string>("clean_privacy_all", { paths: allPaths, flushDns: hasDns });
                if (allPaths.length > 0 && result.startsWith("0 ")) {
                    toast.error("Bazı dosyalar silinemedi — Ayarlar'dan Tam Disk Erişimi verin.");
                }
            }
            if (hasClipboard) {
                await invoke("clear_clipboard");
            }

            setCleanAllMsg("Tümü temizlendi!");
            await scan();
        } catch (e) {
            toast.error(String(e));
        }
        setCleaningAll(false);
    };

    return (
        <div className="fade-in" style={{ padding: "24px 28px", display: "flex", flexDirection: "column", gap: 12 }}>

            {/* Page title + scan button */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, color: "#F5EDD6", fontFamily: "'New York', 'Iowan Old Style', Georgia, serif", letterSpacing: "-0.02em" }}>
                    Gizlilik
                </h1>
                <button
                    onClick={scan} disabled={scanning}
                    style={{
                        padding: "7px 20px",
                        background: scanning ? "rgba(245,237,214,0.07)" : "#F5EDD6",
                        border: "1px solid rgba(245,237,214,0.45)",
                        borderRadius: 99, fontSize: 13, fontWeight: 700,
                        color: scanning ? "rgba(245,237,214,0.3)" : "#150b00",
                        cursor: scanning ? "not-allowed" : "pointer",
                        transition: "all 0.15s",
                    }}
                    onMouseEnter={e => { if (!scanning) e.currentTarget.style.background = "rgba(245,237,214,0.82)"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = scanning ? "rgba(245,237,214,0.07)" : "#F5EDD6"; }}
                >
                    {scanning ? "Taranıyor…" : "Şimdi Tara"}
                </button>
            </div>

            {/* TCC info banner */}
            <div style={{ borderRadius: 10, padding: "8px 12px", border: "1px solid rgba(245,237,214,0.18)", background: "rgba(245,237,214,0.06)", display: "flex", alignItems: "center", gap: 8 }}>
                <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="#F5EDD6" strokeWidth={2} style={{ flexShrink: 0 }}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span style={{ fontSize: 11, color: "rgba(245,237,214,0.4)", flex: 1 }}>
                    Tarayıcı geçmişi ve çerezler için <strong style={{ color: "rgba(245,237,214,0.65)" }}>Tam Disk Erişimi</strong> gereklidir
                </span>
                <button
                    onClick={() => invoke("open_system_settings")}
                    style={{
                        fontSize: 10, fontWeight: 600, flexShrink: 0,
                        color: "#F5EDD6", background: "rgba(245,237,214,0.1)",
                        border: "1px solid rgba(245,237,214,0.25)",
                        borderRadius: 99, padding: "3px 10px", cursor: "pointer",
                        transition: "all 0.12s",
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = "rgba(245,237,214,0.18)"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "rgba(245,237,214,0.1)"; }}
                >
                    Ayarları Aç
                </button>
            </div>

            {/* Skeleton */}
            {scanning && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} />)}
                </div>
            )}

            {/* Results */}
            {report && !scanning && (
                <div className="fade-in" style={{ display: "flex", flexDirection: "column", gap: 8 }}>

                    {/* Summary banner */}
                    <div style={{
                        borderRadius: 14, padding: "16px 18px",
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        flexWrap: "wrap", gap: 10,
                        background: "rgba(245,237,214,0.07)",
                        border: "1px solid rgba(245,237,214,0.16)",
                    }}>
                        <div>
                            <span style={{ fontSize: 26, fontWeight: 800, color: "#F5EDD6", fontFamily: "'New York', 'Iowan Old Style', Georgia, serif" }}>
                                {report.total_size > 0 ? report.total_size_human : "Temizlenmeye Hazır"}
                            </span>
                            <p style={{ margin: "2px 0 0", fontSize: 11, color: "rgba(245,237,214,0.32)" }}>
                                {report.categories.length} gizlilik kategorisi bulundu
                            </p>
                        </div>

                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            {cleanAllMsg && (
                                <span style={{ fontSize: 12, color: "rgba(245,237,214,0.7)", fontWeight: 600 }}>
                                    {cleanAllMsg}
                                </span>
                            )}
                            {cleaningAll && (
                                <span style={{ fontSize: 12, color: "rgba(245,237,214,0.45)" }}>Temizleniyor…</span>
                            )}
                            {!confirmCleanAll && !cleaningAll && (
                                <button
                                    onClick={() => setConfirmCleanAll(true)}
                                    style={{
                                        padding: "7px 18px", fontSize: 12, fontWeight: 700,
                                        color: "#150b00", background: "#F5EDD6",
                                        border: "1px solid rgba(245,237,214,0.45)",
                                        borderRadius: 99, cursor: "pointer", transition: "all 0.15s",
                                    }}
                                    onMouseEnter={e => { e.currentTarget.style.background = "rgba(245,237,214,0.82)"; }}
                                    onMouseLeave={e => { e.currentTarget.style.background = "#F5EDD6"; }}
                                >
                                    Tümünü Temizle
                                </button>
                            )}
                            {confirmCleanAll && (
                                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                    <span style={{ fontSize: 11, color: "rgba(245,237,214,0.38)" }}>Emin misin?</span>
                                    <button
                                        onClick={handleCleanAll}
                                        style={{
                                            padding: "6px 14px", fontSize: 12, fontWeight: 600,
                                            color: "#F5EDD6", background: "rgba(200,80,80,0.22)",
                                            border: "1px solid rgba(200,80,80,0.45)",
                                            borderRadius: 99, cursor: "pointer", transition: "all 0.15s",
                                        }}
                                        onMouseEnter={e => { e.currentTarget.style.background = "rgba(200,80,80,0.38)"; }}
                                        onMouseLeave={e => { e.currentTarget.style.background = "rgba(200,80,80,0.22)"; }}
                                    >
                                        Evet, Temizle
                                    </button>
                                    <button
                                        onClick={() => setConfirmCleanAll(false)}
                                        style={{
                                            padding: "6px 12px", fontSize: 12,
                                            color: "rgba(245,237,214,0.38)", background: "transparent",
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

                    {report.categories.map(cat => (
                        <CategoryCard
                            key={cat.id}
                            cat={cat}
                            totalSize={report.total_size}
                            globalCleaning={cleaningAll}
                            onClean={() => cleanCategory(cat)}
                        />
                    ))}

                    <p style={{ fontSize: 11, color: "rgba(245,237,214,0.18)", textAlign: "center", margin: "4px 0 0" }}>
                        En iyi sonuç için tarayıcıları kapatıp geçmişi temizleyin
                    </p>
                </div>
            )}

            {/* Empty state */}
            {!report && !scanning && (
                <div style={{ textAlign: "center", padding: "60px 0" }}>
                    <p style={{ fontSize: 18, fontWeight: 700, fontFamily: "'New York', 'Iowan Old Style', Georgia, serif", color: "rgba(245,237,214,0.35)", margin: "0 0 8px" }}>
                        Taramaya Hazır
                    </p>
                    <p style={{ fontSize: 12, color: "rgba(245,237,214,0.2)", margin: 0 }}>
                        Özel verileri bulmak için "Şimdi Tara"ya tıklayın
                    </p>
                </div>
            )}
        </div>
    );
}
