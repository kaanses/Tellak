import React, { useEffect, useRef, useState } from "react";
import { Sparkles, Monitor, Database, Trash2, Lock, Copy } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useAppStore } from "../../shared/store";
import { useI18n } from "../../shared/i18n";
import tellakImg from "../../assets/tellak.png";
import tellakIcon from "../../assets/tellak-icon.png";


// Reveal results once this many of the 12 categories have reported. The fast
// du-based categories finish in 1–3s; slower ones (large files, old downloads)
// then stream in behind a shimmer instead of holding the whole dashboard back.
const REVEAL_AT = 10;

interface JunkCategory { size: number; }
interface JunkScanDone { total_size: number; total_size_human: string; }

function humanizeBytes(b: number) {
    if (b === 0) return "0 B";
    const u = ["B", "KB", "MB", "GB", "TB"];
    let i = 0, s = b;
    while (s >= 1024 && i < u.length - 1) { s /= 1024; i++; }
    return i === 0 ? `${b} B` : `${s.toFixed(1)} ${u[i]}`;
}

function statColor(pct: number) {
    if (pct >= 85) return "rgba(200,80,80,0.85)";
    if (pct >= 65) return "#D4920A";
    return "rgba(245,237,214,0.85)";
}

// ── Mascot hero ───────────────────────────────────────────────────────────────

function MascotHero({ rings = false }: { rings?: boolean }) {
    return (
        <div style={{ width: 420, flexShrink: 0, position: "relative" }}>
            {/* Glow behind mascot */}
            <div style={{
                position: "absolute",
                top: "30%", left: "50%",
                transform: "translate(-50%, -50%)",
                width: 340, height: 340,
                borderRadius: "50%",
                background: "radial-gradient(circle, rgba(245,237,214,0.07) 0%, rgba(245,237,214,0.03) 45%, transparent 70%)",
                pointerEvents: "none",
                zIndex: 0,
            }} />
            {/* Glow behind title */}
            <div style={{
                position: "absolute",
                top: "72%", left: "54%",
                transform: "translate(-50%, -50%)",
                width: 280, height: 160,
                borderRadius: "50%",
                background: "radial-gradient(ellipse, rgba(245,237,214,0.06) 0%, rgba(245,237,214,0.02) 50%, transparent 70%)",
                pointerEvents: "none",
                zIndex: 0,
            }} />
            {rings && (
                <>
                    <div className="scan-ring" style={{ top: 252, left: 210, animationDelay: "0s", zIndex: 0 }} />
                    <div className="scan-ring" style={{ top: 252, left: 210, animationDelay: "-1.3s", zIndex: 0 }} />
                </>
            )}
            <img
                src={tellakImg}
                alt="Tellak"
                style={{
                    width: 388, height: "auto", display: "block",
                    marginBottom: -20,
                    pointerEvents: "none",
                    position: "relative", zIndex: 2,
                    filter: "invert(1) brightness(0.88) sepia(0.45)",
                    transform: "rotate(4deg)",
                }}
            />
            <div style={{
                paddingLeft: 96, marginTop: -203,
                pointerEvents: "none",
                position: "relative", zIndex: 1,
            }}>
                <div style={{
                    display: "flex", alignItems: "baseline",
                    fontFamily: '"New York", "Georgia", "Times New Roman", serif',
                    fontStyle: "italic", fontWeight: 700,
                    color: "rgba(245,237,214,0.82)", letterSpacing: "-0.02em",
                    textShadow: "0 2px 40px rgba(0,0,0,1)",
                }}>
                    <span style={{ fontSize: 96, lineHeight: 1 }}>Te</span>
                    <span style={{ fontSize: 108, lineHeight: 1 }}>ll</span>
                    <span style={{ fontSize: 96, lineHeight: 1 }}>ak</span>
                </div>
            </div>
        </div>
    );
}

// ── Result Card ───────────────────────────────────────────────────────────────

interface CardProps {
    icon: React.ReactNode;
    category: string;
    metric: string;
    sub: string;
    cta: string;
    accentColor: string;
    gradientFrom: string;
    gradientTo: string;
    onClick: () => void;
    loading?: boolean;
}

function ResultCard({ icon, category, metric, sub, cta, accentColor, gradientFrom, gradientTo, onClick, loading }: CardProps) {
    const [hovered, setHovered] = useState(false);
    return (
        <button
            onClick={onClick}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            style={{
                background: `linear-gradient(145deg, ${gradientFrom} 0%, ${gradientTo} 100%)`,
                border: `1px solid ${hovered ? "rgba(245,237,214,0.12)" : "rgba(245,237,214,0.05)"}`,
                borderRadius: 20,
                padding: "22px 22px 18px",
                display: "flex",
                flexDirection: "column",
                cursor: "pointer",
                textAlign: "left",
                transition: "all 0.2s ease",
                transform: hovered ? "translateY(-2px)" : "translateY(0)",
                boxShadow: hovered ? "0 12px 40px rgba(0,0,0,0.4)" : "0 4px 20px rgba(0,0,0,0.2)",
            }}
        >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: accentColor, opacity: 0.8 }}>
                    {category}
                    {loading && <span className="ring-pulse" style={{ width: 5, height: 5, borderRadius: "50%", background: accentColor }} />}
                </span>
                <span style={{ color: "#F5EDD6", opacity: 0.7, filter: "drop-shadow(0 0 8px rgba(212,146,10,0.5))" }}>
                    {icon}
                </span>
            </div>
            <span style={{ fontSize: 30, fontWeight: 800, color: "#F5EDD6", letterSpacing: "-0.04em", lineHeight: 1, marginBottom: 6 }}>
                {metric}
            </span>
            <span style={{ fontSize: 12, color: "rgba(245,237,214,0.4)", marginBottom: 18, lineHeight: 1.4 }}>
                {sub}
            </span>
            <span style={{ color: accentColor, fontSize: 11, fontWeight: 600 }}>
                {cta} →
            </span>
        </button>
    );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

export default function Dashboard() {
    const { fetchSystemStatus, systemStatus, junkScan, setJunkScan } = useAppStore();
    const { t } = useI18n();
    const navigate = useNavigate();
    const unlistenRef  = useRef<(() => void)[]>([]);
    const scanningRef  = useRef(false);

    // Scan state lives in the store so it survives navigating to an action
    // page and back (see store/index.ts JunkScan).
    const { state: scanState, count: scanCount, total: junkTotal, human: junkHuman } = junkScan;

    const data     = systemStatus.data;
    const ramPct   = (data?.Memory?.UsedPercent as number) ?? 0;
    const disks    = (data?.Disks as any[]) ?? [];
    const diskPct  = disks.length > 0 ? Math.max(...disks.map((d: any) => d.UsedPercent)) : 0;
    const diskFree = disks.length > 0
        ? (((disks[0]?.Total as number) ?? 0) - ((disks[0]?.Used as number) ?? 0)) / 1_073_741_824
        : 0;

    useEffect(() => { fetchSystemStatus(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => () => { unlistenRef.current.forEach(u => u()); }, []);

    const startScan = async () => {
        if (scanningRef.current) return;
        scanningRef.current = true;

        setJunkScan({ state: "scanning", count: 0, total: 0, human: "" });
        unlistenRef.current.forEach(u => u());
        unlistenRef.current = [];
        fetchSystemStatus(true);

        const ul1 = await listen<JunkCategory>("junk_category", e => {
            setJunkScan(p => ({ total: p.total + e.payload.size }));
        });
        const ulProgress = await listen("junk_progress", () => setJunkScan(p => {
            const next = p.count + 1;
            // Reveal the result cards as soon as the fast categories are in —
            // the rest fill in live without making the user stare at a counter.
            return { count: next, state: next >= REVEAL_AT ? "done" : p.state };
        }));
        const ul2 = await listen<JunkScanDone>("junk_scan_done", e => {
            setJunkScan({
                total: e.payload.total_size,
                human: e.payload.total_size_human,
                count: 12,
                state: "done",
            });
            scanningRef.current = false;
            ul1(); ul2(); ulProgress();
            unlistenRef.current = [];
        });
        unlistenRef.current = [ul1, ul2, ulProgress];

        try {
            await invoke("scan_junk_streaming", { force: true });
        } catch {
            setJunkScan({ state: "idle" });
            scanningRef.current = false;
            unlistenRef.current.forEach(u => u());
            unlistenRef.current = [];
        }
    };

    // If we navigated away mid-scan, the listeners were torn down on unmount —
    // resume so the user doesn't get stuck on a frozen scanning screen.
    useEffect(() => {
        if (junkScan.state === "scanning" && !scanningRef.current) startScan();
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Idle ─────────────────────────────────────────────────────────────────
    if (scanState === "idle") {
        return (
            <div style={{
                height: "100vh",
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 20,
                background: "#150b00",
            }}>
                <MascotHero />

                <button onClick={startScan} style={{
                    background: "none", border: "none", cursor: "pointer", padding: 0,
                    position: "relative", width: 110, height: 110,
                    display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                    {/* Curved "TARA" text — inside circle, right side, counter-clockwise */}
                    <svg width="110" height="110" viewBox="0 0 110 110" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
                        <defs>
                            <path id="taraArc" d="M 19,55 A 36,36 0 0,1 91,55" />
                        </defs>
                        <text fontSize="8" fontWeight="600" letterSpacing="3.5" fill="rgba(245,237,214,0.75)"
                            fontFamily="-apple-system, BlinkMacSystemFont, sans-serif" textAnchor="middle">
                            <textPath href="#taraArc" startOffset="50%">{t("dashboard.scanCta")}</textPath>
                        </text>
                    </svg>
                    {/* Circle button */}
                    <div style={{
                        width: 80, height: 80, borderRadius: "50%",
                        background: "rgba(245,237,214,0.04)",
                        border: "1px solid rgba(245,237,214,0.12)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        overflow: "hidden",
                        transition: "all 0.2s",
                    }}
                        onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = "rgba(245,237,214,0.08)"; (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(245,237,214,0.22)"; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = "rgba(245,237,214,0.04)"; (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(245,237,214,0.12)"; }}
                    >
                        <img src={tellakIcon} alt="" style={{
                            width: 52, height: 52,
                            objectFit: "contain",
                            filter: "invert(1) brightness(0.88) sepia(0.45)",
                            pointerEvents: "none",
                        }} />
                    </div>
                </button>
            </div>
        );
    }

    // ── Scanning ─────────────────────────────────────────────────────────────
    if (scanState === "scanning") {
        return (
            <div style={{
                height: "100vh",
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 20,
                background: "#150b00",
            }}>
                <MascotHero rings />

                {(() => {
                    const r = 38;
                    const circ = 2 * Math.PI * r;
                    const pct = scanCount / 12;
                    const offset = circ * (1 - pct);
                    const glow = `0 0 ${20 + pct * 30}px rgba(245,237,214,${0.06 + pct * 0.12}), 0 0 10px rgba(245,237,214,0.04) inset`;
                    return (
                        <div key={scanCount} className="ring-pulse" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
                            <div style={{ position: "relative", width: 88, height: 88 }}>
                                <svg width="88" height="88" style={{ position: "absolute", top: 0, left: 0 }}>
                                    <circle cx="44" cy="44" r={r} fill="none" stroke="rgba(245,237,214,0.08)" strokeWidth="1.5" />
                                    <circle cx="44" cy="44" r={r} fill="none"
                                        stroke="rgba(245,237,214,0.7)" strokeWidth="1.5"
                                        strokeLinecap="round"
                                        strokeDasharray={circ}
                                        strokeDashoffset={offset}
                                        transform="rotate(-90 44 44)"
                                        style={{ transition: "stroke-dashoffset 0.5s ease" }}
                                    />
                                </svg>
                                <div style={{
                                    position: "absolute", inset: 0,
                                    borderRadius: "50%",
                                    background: "rgba(245,237,214,0.03)",
                                    border: "1px solid rgba(245,237,214,0.1)",
                                    boxShadow: glow,
                                    transition: "box-shadow 0.5s ease",
                                    display: "flex", alignItems: "center", justifyContent: "center",
                                }}>
                                    <span key={scanCount} className="count-up" style={{
                                        fontSize: 16, fontWeight: 700,
                                        color: "rgba(245,237,214,0.82)", letterSpacing: "-0.02em",
                                        fontVariantNumeric: "tabular-nums",
                                        lineHeight: 1,
                                    }}>
                                        {scanCount}<span style={{ fontSize: 10, opacity: 0.45, marginLeft: 1 }}>/12</span>
                                    </span>
                                </div>
                            </div>
                        </div>
                    );
                })()}
            </div>
        );
    }

    // ── Done ─────────────────────────────────────────────────────────────────
    // We reveal at REVEAL_AT/12; the remaining slow categories are still
    // streaming in until junk_scan_done lands and bumps the count to 12.
    const finalizing = scanCount < 12;
    return (
        <div className="fade-in" style={{
            minHeight: "100vh",
            padding: "32px 32px 32px",
            background: "radial-gradient(ellipse at 50% 0%, #2d1500 0%, #150b00 55%)",
        }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 28 }}>
                <div>
                    <h2 style={{ margin: "0 0 10px", fontSize: 24, fontWeight: 800, color: "#F5EDD6", letterSpacing: "-0.03em" }}>
                        {t("dashboard.scanComplete")}
                    </h2>
                    <div style={{ display: "flex", alignItems: "center" }}>
                        {systemStatus.loading ? (
                            <div className="shimmer" style={{ width: 240, height: 14, borderRadius: 4 }} />
                        ) : (
                            [
                                { label: "CPU",  value: `${((data?.CPU?.Usage as number) ?? 0).toFixed(0)}%`,  color: statColor((data?.CPU?.Usage as number) ?? 0) },
                                { label: "RAM",  value: `${ramPct.toFixed(0)}%`, color: statColor(ramPct) },
                                { label: "Disk", value: `${diskPct.toFixed(0)}%`, color: statColor(diskPct) },
                                { label: t("dashboard.statFree"),  value: `${diskFree.toFixed(1)} GB`, color: "rgba(245,237,214,0.45)" },
                            ].map((s, i) => (
                                <span key={s.label} style={{ display: "flex", alignItems: "center" }}>
                                    {i > 0 && <span style={{ color: "rgba(245,237,214,0.12)", margin: "0 10px", fontSize: 12 }}>|</span>}
                                    <span style={{ fontSize: 11, color: "rgba(245,237,214,0.3)", letterSpacing: "0.08em", textTransform: "uppercase", marginRight: 5, fontWeight: 600 }}>{s.label}</span>
                                    <span style={{ fontSize: 13, fontWeight: 700, color: s.color, fontVariantNumeric: "tabular-nums" }}>{s.value}</span>
                                </span>
                            ))
                        )}
                    </div>
                </div>
                <button
                    onClick={startScan}
                    style={{
                        display: "flex", alignItems: "center", gap: 7,
                        padding: "8px 18px", fontSize: 13, fontWeight: 600,
                        color: "rgba(245,237,214,0.55)", background: "rgba(245,237,214,0.05)",
                        border: "1px solid rgba(245,237,214,0.1)", borderRadius: 99,
                        cursor: "pointer", transition: "all 0.15s", flexShrink: 0,
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = "rgba(245,237,214,0.1)"; e.currentTarget.style.color = "rgba(245,237,214,0.8)"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "rgba(245,237,214,0.05)"; e.currentTarget.style.color = "rgba(245,237,214,0.55)"; }}
                >
                    <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                        <path d="M1 4v6h6M23 20v-6h-6"/><path d="M20.49 9A9 9 0 005.64 5.64L1 10M23 14l-4.64 4.36A9 9 0 013.51 15"/>
                    </svg>
                    {t("dashboard.rescan")}
                </button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
                <ResultCard icon={<Sparkles size={28} strokeWidth={1.5} />} category={t("dashboard.cardCleanerLabel")} metric={junkHuman || humanizeBytes(junkTotal)} sub={finalizing ? t("dashboard.cardCleanerCalculating") : t("dashboard.cardCleanerSub")} cta={t("dashboard.cardCleanerCta")}    accentColor="rgba(245,237,214,0.75)" gradientFrom="#130d06" gradientTo="#1c1309" loading={finalizing} onClick={() => navigate("/clean", { state: { autoScan: true } })} />
                <ResultCard icon={<Monitor size={28} strokeWidth={1.5} />} category={t("dashboard.cardRamLabel")} metric={`${ramPct.toFixed(0)}%`} sub={t("dashboard.cardRamSub")} cta={t("dashboard.cardRamCta")} accentColor="rgba(245,237,214,0.7)" gradientFrom="#130d06" gradientTo="#1c1309" onClick={() => navigate("/ram")} />
                <ResultCard icon={<Database size={28} strokeWidth={1.5} />} category={t("dashboard.cardDiskLabel")} metric={`${diskPct.toFixed(0)}%`} sub={t("dashboard.cardDiskSub", { gb: diskFree.toFixed(1) })} cta={t("dashboard.cardDiskCta")} accentColor="rgba(245,237,214,0.5)" gradientFrom="#100c05" gradientTo="#181107" onClick={() => navigate("/analyze")} />
                <ResultCard icon={<Trash2 size={28} strokeWidth={1.5} />} category={t("dashboard.cardTrashLabel")} metric={t("dashboard.cardTrashMetric")} sub={t("dashboard.cardTrashSub")} cta={t("dashboard.cardTrashCta")} accentColor="rgba(245,237,214,0.6)" gradientFrom="#100c05" gradientTo="#181107" onClick={() => navigate("/trash")} />
                <ResultCard icon={<Lock size={28} strokeWidth={1.5} />} category={t("dashboard.cardPrivacyLabel")} metric={t("dashboard.cardPrivacyMetric")} sub={t("dashboard.cardPrivacySub")} cta={t("dashboard.cardPrivacyCta")} accentColor="rgba(245,237,214,0.6)" gradientFrom="#100c05" gradientTo="#181107" onClick={() => navigate("/privacy")} />
                <ResultCard icon={<Copy size={28} strokeWidth={1.5} />} category={t("dashboard.cardDuplicatesLabel")} metric={t("dashboard.cardDuplicatesMetric")} sub={t("dashboard.cardDuplicatesSub")} cta={t("dashboard.cardDuplicatesCta")} accentColor="rgba(245,237,214,0.4)" gradientFrom="#0e0b04" gradientTo="#161006" onClick={() => navigate("/duplicates")} />
            </div>
        </div>
    );
}
