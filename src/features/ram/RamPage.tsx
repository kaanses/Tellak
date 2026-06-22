import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useNavigate } from "react-router-dom";
import { useToast } from "../../shared/store/toastStore";

interface RamStats {
    total: number;
    used: number;
    available: number;
    used_percent: number;
    total_human: string;
    used_human: string;
    available_human: string;
}

const KEYFRAMES = `
@keyframes ram-glow-pulse {
    0%, 100% { opacity: 0.18; }
    50%       { opacity: 0.45; }
}
@keyframes ram-spin {
    from { transform: rotate(-90deg); }
    to   { transform: rotate(270deg); }
}
@keyframes stat-flash {
    0%   { opacity: 0.4; transform: scale(0.94); }
    60%  { opacity: 1;   transform: scale(1.05); }
    100% { opacity: 1;   transform: scale(1); }
}
@keyframes ram-success-ring {
    0%   { opacity: 0;   stroke-dashoffset: 0; }
    15%  { opacity: 0.8; }
    100% { opacity: 0;   stroke-dashoffset: -516; }
}
@keyframes ram-badge-in {
    0%   { opacity: 0; transform: translateY(12px) scale(0.9); }
    65%  { opacity: 1; transform: translateY(-3px) scale(1.03); }
    100% { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes ram-check-draw {
    from { stroke-dashoffset: 40; opacity: 0; }
    to   { stroke-dashoffset: 0;  opacity: 1; }
}
`;

function ringColor(percent: number): string {
    if (percent >= 85) return "rgba(200,80,80,0.85)";
    if (percent >= 65) return "rgba(245,237,214,0.6)";
    return "rgba(245,237,214,0.85)";
}

function useAnimatedNumber(target: number, duration = 1200): number {
    const [value, setValue] = useState(target);
    const frameRef = useRef(0);
    const fromRef  = useRef(target);

    useEffect(() => {
        const from = fromRef.current;
        cancelAnimationFrame(frameRef.current);
        if (from === target) return;
        const start = performance.now();
        const tick = (now: number) => {
            const t    = Math.min((now - start) / duration, 1);
            const ease = 1 - Math.pow(1 - t, 3);
            setValue(from + (target - from) * ease);
            if (t < 1) frameRef.current = requestAnimationFrame(tick);
            else fromRef.current = target;
        };
        frameRef.current = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frameRef.current);
    }, [target]);

    return value;
}

function RamRing({ percent, loading, optimizing, optimized }: {
    percent: number; loading: boolean; optimizing: boolean; optimized: boolean;
}) {
    const sz = 200, R = 82, C = 2 * Math.PI * R, cx = sz / 2;
    const animated = useAnimatedNumber(percent);
    const fill     = loading ? 0 : (animated / 100) * C;
    const color    = ringColor(percent);
    const spinDash = C * 0.22;

    return (
        <div style={{ position: "relative", width: sz, height: sz }}>
            <svg width={sz} height={sz} viewBox={`0 0 ${sz} ${sz}`} overflow="visible">
                {/* Track */}
                <circle cx={cx} cy={cx} r={R} fill="none"
                    stroke="rgba(245,237,214,0.08)" strokeWidth={10} />

                {/* Normal fill */}
                {!loading && !optimizing && !optimized && <>
                    <circle cx={cx} cy={cx} r={R} fill="none"
                        stroke={color} strokeWidth={14} strokeLinecap="round"
                        strokeDasharray={`${fill} ${C}`}
                        transform={`rotate(-90 ${cx} ${cx})`}
                        style={{
                            filter: "blur(10px)",
                            animation: "ram-glow-pulse 2.6s ease-in-out infinite",
                            transition: "stroke-dasharray 1.2s cubic-bezier(0.4,0,0.2,1), stroke 0.8s",
                        }} />
                    <circle cx={cx} cy={cx} r={R} fill="none"
                        stroke={color} strokeWidth={10} strokeLinecap="round"
                        strokeDasharray={`${fill} ${C}`}
                        transform={`rotate(-90 ${cx} ${cx})`}
                        style={{ transition: "stroke-dasharray 1.2s cubic-bezier(0.4,0,0.2,1), stroke 0.8s" }} />
                </>}

                {/* Optimizing spinner */}
                {optimizing && <>
                    <circle cx={cx} cy={cx} r={R} fill="none"
                        stroke="rgba(245,237,214,0.1)" strokeWidth={10}
                        strokeDasharray={`${spinDash} ${C - spinDash}`}
                        style={{ transformOrigin: `${cx}px ${cx}px`, animation: "ram-spin 0.9s linear infinite" }} />
                    <circle cx={cx} cy={cx} r={R} fill="none"
                        stroke="rgba(245,237,214,0.85)" strokeWidth={10} strokeLinecap="round"
                        strokeDasharray={`${spinDash} ${C - spinDash}`}
                        style={{ transformOrigin: `${cx}px ${cx}px`, animation: "ram-spin 0.9s linear infinite", filter: "blur(7px)", opacity: 0.5 }} />
                </>}

                {/* Success ring */}
                {optimized && <>
                    <circle cx={cx} cy={cx} r={R} fill="none"
                        stroke="rgba(245,237,214,0.85)" strokeWidth={12} strokeLinecap="round"
                        strokeDasharray={`${C} ${C}`}
                        transform={`rotate(-90 ${cx} ${cx})`}
                        style={{ filter: "blur(10px)", animation: "ram-success-ring 1.6s ease-out forwards" }} />
                    <circle cx={cx} cy={cx} r={R} fill="none"
                        stroke="rgba(245,237,214,0.85)" strokeWidth={10} strokeLinecap="round"
                        strokeDasharray={`${C} ${C}`}
                        transform={`rotate(-90 ${cx} ${cx})`}
                        style={{ animation: "ram-success-ring 1.6s ease-out forwards" }} />
                </>}
            </svg>

            {/* Center content */}
            <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2 }}>
                {loading
                    ? <div className="shimmer" style={{ width: 60, height: 44 }} />
                    : optimizing
                    ? <span style={{ fontSize: 12, color: "rgba(245,237,214,0.5)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                        optimize ediliyor
                      </span>
                    : optimized
                    ? <svg width={48} height={48} viewBox="0 0 48 48" fill="none">
                        <path d="M10 25 L20 35 L38 15" stroke="rgba(245,237,214,0.85)" strokeWidth={4}
                            strokeLinecap="round" strokeLinejoin="round"
                            strokeDasharray={40} strokeDashoffset={40}
                            style={{ animation: "ram-check-draw 0.5s 0.15s ease-out forwards" }} />
                      </svg>
                    : <>
                        <span style={{
                            fontSize: 46, fontWeight: 800, lineHeight: 1,
                            color, letterSpacing: "-0.04em",
                            fontFamily: "'New York', 'Iowan Old Style', Georgia, serif",
                            transition: "color 0.8s ease",
                        }}>
                            {animated.toFixed(0)}
                        </span>
                        <span style={{ fontSize: 11, color: "rgba(245,237,214,0.22)", textTransform: "uppercase", letterSpacing: "0.12em" }}>
                            % kullanım
                        </span>
                    </>
                }
            </div>
        </div>
    );
}

export default function RamPage() {
    const [stats,      setStats]      = useState<RamStats | null>(null);
    const [loading,    setLoading]    = useState(true);
    const [statsKey,   setStatsKey]   = useState(0);
    const toast = useToast();
    const navigate = useNavigate();
    const [optimizing, setOptimizing] = useState(false);
    const [optimized,  setOptimized]  = useState(false);
    const [freed,      setFreed]      = useState<string | null>(null);

    const load = async (silent = false) => {
        if (!silent) setLoading(true);
        if (silent) setOptimized(false);
        try {
            const s = await invoke<RamStats>("get_ram_stats");
            setStats(s);
            if (silent) setStatsKey(k => k + 1);
        } catch (e) { if (!silent) toast.error(String(e)); }
        if (!silent) setLoading(false);
    };

    useEffect(() => { load(); }, []);

    const handleOptimize = async () => {
        setOptimizing(true); setFreed(null); setOptimized(false);
        try {
            const result = await invoke<string>("optimize_ram");
            setOptimized(true);
            setFreed(result !== "0 B" ? result : null);
            const s = await invoke<RamStats>("get_ram_stats");
            setStats(s);
            setStatsKey(k => k + 1);
        } catch (e) { toast.error(String(e)); }
        setOptimizing(false);
    };

    const STAT_COLS = [
        { label: "Toplam",    value: stats?.total_human,     color: "rgba(245,237,214,0.75)" },
        { label: "Kullanılan", value: stats?.used_human,     color: "#F5EDD6" },
        { label: "Boş",       value: stats?.available_human, color: "rgba(245,237,214,0.55)" },
    ];

    return (
        <div className="fade-in" style={{ padding: "24px 28px", display: "flex", flexDirection: "column", gap: 0 }}>
            <style>{KEYFRAMES}</style>

            {/* Page title */}
            <h1 style={{ margin: "0 0 32px", fontSize: 28, fontWeight: 700, color: "#F5EDD6", fontFamily: "'New York', 'Iowan Old Style', Georgia, serif", letterSpacing: "-0.02em" }}>
                RAM
            </h1>

            {/* Centered content */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 28 }}>

                <RamRing
                    percent={stats?.used_percent ?? 0}
                    loading={loading}
                    optimizing={optimizing}
                    optimized={optimized}
                />

                {/* Stats row */}
                <div style={{
                    background: "rgba(245,237,214,0.04)",
                    border: "1px solid rgba(245,237,214,0.1)",
                    borderRadius: 18, padding: "20px 44px",
                    display: "flex", gap: 44, alignItems: "center",
                }}>
                    {STAT_COLS.map(({ label, value, color }, i) => (
                        <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                            {loading
                                ? <div className="shimmer" style={{ width: 56, height: 22 }} />
                                : <span
                                    key={`${statsKey}-${i}`}
                                    style={{
                                        fontSize: 20, fontWeight: 700, color,
                                        fontVariantNumeric: "tabular-nums",
                                        animation: statsKey > 0 ? "stat-flash 0.45s ease-out" : undefined,
                                    }}
                                  >
                                    {value}
                                  </span>
                            }
                            <span style={{ fontSize: 10, color: "rgba(245,237,214,0.22)", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 600 }}>
                                {label}
                            </span>
                        </div>
                    ))}
                </div>

                {/* Success badge */}
                {optimized && (
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, animation: "ram-badge-in 0.5s cubic-bezier(0.34,1.56,0.64,1) forwards" }}>
                        <div style={{
                            background: "rgba(245,237,214,0.1)", border: "1px solid rgba(245,237,214,0.28)",
                            borderRadius: 99, padding: "8px 24px",
                        }}>
                            <span style={{ fontSize: 14, fontWeight: 700, color: "#F5EDD6" }}>
                                {freed ? `${freed} kurtarıldı — Bellek optimize edildi` : "Bellek başarıyla optimize edildi"}
                            </span>
                        </div>
                        <button
                            onClick={() => navigate("/")}
                            style={{
                                padding: "9px 28px", fontSize: 13, fontWeight: 600,
                                color: "#150b00",
                                background: "#F5EDD6",
                                border: "1px solid rgba(245,237,214,0.45)",
                                borderRadius: 99, cursor: "pointer", transition: "all 0.15s",
                            }}
                            onMouseEnter={e => { e.currentTarget.style.background = "rgba(245,237,214,0.82)"; }}
                            onMouseLeave={e => { e.currentTarget.style.background = "#F5EDD6"; }}
                        >
                            Ana Sayfaya Git
                        </button>
                    </div>
                )}

                {/* Free RAM button */}
                {!optimized && (
                    <button
                        onClick={handleOptimize}
                        disabled={optimizing || loading}
                        style={{
                            padding: "12px 48px", fontSize: 15, fontWeight: 700,
                            color: optimizing ? "rgba(245,237,214,0.3)" : "#150b00",
                            background: optimizing ? "rgba(245,237,214,0.07)" : "#F5EDD6",
                            border: "1px solid rgba(245,237,214,0.45)",
                            borderRadius: 99, cursor: optimizing ? "not-allowed" : "pointer",
                            transition: "all 0.15s",
                        }}
                        onMouseEnter={e => { if (!optimizing && !loading) e.currentTarget.style.background = "rgba(245,237,214,0.82)"; }}
                        onMouseLeave={e => { e.currentTarget.style.background = optimizing ? "rgba(245,237,214,0.07)" : "#F5EDD6"; }}
                    >
                        {optimizing ? "Optimize Ediliyor…" : "RAM'i Temizle"}
                    </button>
                )}

                {/* Footer note + refresh */}
                <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                    <p style={{ margin: 0, fontSize: 11, color: "rgba(245,237,214,0.18)", textAlign: "center", lineHeight: 1.6 }}>
                        macOS memory purge çalıştırır — yönetici şifresi gerektirir.
                    </p>
                    <button
                        onClick={() => load(true)}
                        disabled={loading || optimizing}
                        style={{
                            padding: "4px 12px", fontSize: 11,
                            color: "rgba(245,237,214,0.3)",
                            background: "transparent",
                            border: "1px solid rgba(245,237,214,0.1)",
                            borderRadius: 99, cursor: loading || optimizing ? "not-allowed" : "pointer",
                            transition: "all 0.15s", flexShrink: 0,
                        }}
                        onMouseEnter={e => { if (!loading && !optimizing) { e.currentTarget.style.color = "rgba(245,237,214,0.55)"; e.currentTarget.style.borderColor = "rgba(245,237,214,0.25)"; }}}
                        onMouseLeave={e => { e.currentTarget.style.color = "rgba(245,237,214,0.3)"; e.currentTarget.style.borderColor = "rgba(245,237,214,0.1)"; }}
                    >
                        Yenile
                    </button>
                </div>

            </div>
        </div>
    );
}
