import { useState } from "react";
import { useUpdater } from "./features/updater/useUpdater";
import { motion, AnimatePresence } from "framer-motion";
import { BrowserRouter, Routes, Route, useNavigate, useLocation } from "react-router-dom";
import "./App.css";
import tellakIcon from "./assets/tellak-icon.png";
import { ToastContainer } from "./shared/components/ToastContainer";
import { useI18n } from "./shared/i18n";
import Dashboard       from "./features/dashboard/Dashboard";
import CleanerPage     from "./features/cleaner/CleanerPage";
import AnalyzerPage    from "./features/analyzer/AnalyzerPage";
import UninstallerPage from "./features/uninstaller/UninstallerPage";
import StartupPage     from "./features/startup/StartupPage";
import DuplicatesPage  from "./features/duplicates/DuplicatesPage";
import TrashPage       from "./features/trash/TrashPage";
import RamPage         from "./features/ram/RamPage";
import PrivacyPage     from "./features/privacy/PrivacyPage";

const NAV = [
    {
        path: "/", label: "nav.home",
        icon: <svg width="17" height="17" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
    },
    {
        path: "/clean", label: "nav.cleaner",
        icon: <svg width="17" height="17" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/><path d="M10 11v5M14 11v5"/></svg>,
    },
    {
        path: "/analyze", label: "nav.disk",
        icon: <svg width="17" height="17" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/></svg>,
    },
    {
        path: "/apps", label: "nav.apps",
        icon: <svg width="17" height="17" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>,
    },
    {
        path: "/startup", label: "nav.startup",
        icon: <svg width="17" height="17" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>,
    },
    {
        path: "/duplicates", label: "nav.duplicates",
        icon: <svg width="17" height="17" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><rect x="8" y="8" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>,
    },
    {
        path: "/trash", label: "nav.trash",
        icon: <svg width="17" height="17" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v5M14 11v5"/><path d="M9 6V4h6v2"/></svg>,
    },
    {
        path: "/ram", label: "nav.ram",
        icon: <svg width="17" height="17" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="8" width="20" height="8" rx="2"/><path d="M6 8V6M10 8V6M14 8V6M18 8V6M6 16v2M10 16v2M14 16v2M18 16v2"/></svg>,
    },
    {
        path: "/privacy", label: "nav.privacy",
        icon: <svg width="17" height="17" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
    },
];

function Sidebar() {
    const location  = useLocation();
    const navigate  = useNavigate();
    const { t, lang, setLang } = useI18n();
    const [expanded, setExpanded] = useState(false);

    return (
        <motion.aside
            onMouseEnter={() => setExpanded(true)}
            onMouseLeave={() => setExpanded(false)}
            animate={{ width: expanded ? 208 : 64 }}
            transition={expanded
                ? { type: "spring", stiffness: 240, damping: 16, mass: 1.1 }   // open: bouncy, moderate
                : { type: "spring", stiffness: 160, damping: 22, mass: 1.4 }   // close: heavier, slower
            }
            style={{
                flexShrink: 0,
                display: "flex",
                flexDirection: "column",
                background: "#0e0700",
                borderRight: "1px solid rgba(255,255,255,0.05)",
                overflow: "hidden",
                paddingTop: 14,
                paddingBottom: 14,
                zIndex: 50,
            }}
        >
            {/* Brand / logo */}
            <div style={{
                height: 46, flexShrink: 0,
                display: "flex", alignItems: "flex-start",
                padding: "0 13px",
                gap: 4,
                marginBottom: 12,
                overflow: "hidden",
            }}>
                <img
                    src={tellakIcon}
                    alt="Tellak"
                    style={{
                        width: 42, height: 42, flexShrink: 0,
                        marginTop: 4,
                        objectFit: "cover",
                        objectPosition: "top center",
                        filter: "invert(1) brightness(0.88) sepia(0.45)",
                    }}
                />
                <AnimatePresence>
                    {expanded && (
                        <motion.span
                            key="brand-label"
                            initial={{ opacity: 0, x: -8 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -8 }}
                            transition={{ type: "spring", stiffness: 300, damping: 22, delay: 0.05 }}
                            style={{
                                fontSize: 22, fontWeight: 700, color: "rgba(245,237,214,0.82)",
                                fontFamily: '"New York", "Georgia", "Times New Roman", serif',
                                fontStyle: "italic",
                                letterSpacing: "-0.02em", whiteSpace: "nowrap",
                                pointerEvents: "none",
                                alignSelf: "center",
                            }}
                        >
                            Tellak
                        </motion.span>
                    )}
                </AnimatePresence>
            </div>

            {/* Divider */}
            <div style={{ height: 1, background: "rgba(255,255,255,0.06)", marginBottom: 6, flexShrink: 0 }} />

            {/* Nav */}
            <nav style={{ flex: 1, display: "flex", flexDirection: "column", gap: 1, padding: "4px 8px", overflow: "hidden" }}>
                {NAV.map((item, index) => {
                    const active = item.path === "/"
                        ? location.pathname === "/"
                        : location.pathname.startsWith(item.path);
                    return (
                        <button
                            key={item.path}
                            title={expanded ? undefined : t(item.label)}
                            onClick={() => navigate(item.path)}
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 10,
                                padding: "9px 10px",
                                borderRadius: 10,
                                border: "none",
                                background: active ? "rgba(245,237,214,0.1)" : "transparent",
                                color: active ? "#F5EDD6" : "rgba(245,237,214,0.32)",
                                cursor: "pointer",
                                textAlign: "left",
                                width: "100%",
                                flexShrink: 0,
                                transition: "background 0.12s, color 0.12s",
                                boxShadow: active ? "inset 2.5px 0 0 #F5EDD6" : "none",
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                            }}
                            onMouseEnter={e => {
                                if (!active) {
                                    e.currentTarget.style.background = "rgba(255,255,255,0.06)";
                                    e.currentTarget.style.color = "rgba(245,237,214,0.65)";
                                }
                            }}
                            onMouseLeave={e => {
                                if (!active) {
                                    e.currentTarget.style.background = "transparent";
                                    e.currentTarget.style.color = "rgba(245,237,214,0.32)";
                                }
                            }}
                        >
                            <span style={{ flexShrink: 0, display: "flex" }}>{item.icon}</span>
                            <AnimatePresence>
                                {expanded && (
                                    <motion.span
                                        key={`label-${item.path}`}
                                        initial={{ opacity: 0, x: -10 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        exit={{ opacity: 0, x: -10 }}
                                        transition={{
                                            type: "spring", stiffness: 320, damping: 24,
                                            delay: index * 0.04,
                                        }}
                                        style={{
                                            fontSize: 13,
                                            fontWeight: active ? 600 : 400,
                                            pointerEvents: "none",
                                            whiteSpace: "nowrap",
                                        }}
                                    >
                                        {t(item.label)}
                                    </motion.span>
                                )}
                            </AnimatePresence>
                        </button>
                    );
                })}
            </nav>

            {/* Language toggle (sidebar footer) */}
            <div style={{ flexShrink: 0, padding: "6px 8px 0", display: "flex", justifyContent: "center" }}>
                <button
                    onClick={() => setLang(lang === "tr" ? "en" : "tr")}
                    title={lang === "tr" ? "Switch to English" : "Türkçe'ye geç"}
                    style={{
                        display: "flex", alignItems: "center", gap: 6,
                        padding: "7px 10px", borderRadius: 10, border: "none",
                        background: "transparent", color: "rgba(245,237,214,0.45)",
                        cursor: "pointer", width: "100%", justifyContent: "center",
                        whiteSpace: "nowrap", overflow: "hidden",
                        transition: "background 0.12s, color 0.12s",
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; e.currentTarget.style.color = "rgba(245,237,214,0.7)"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "rgba(245,237,214,0.45)"; }}
                >
                    <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                    <AnimatePresence>
                        {expanded && (
                            <motion.span
                                key="lang-label"
                                initial={{ opacity: 0, x: -10 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -10 }}
                                transition={{ type: "spring", stiffness: 320, damping: 24 }}
                                style={{ fontSize: 12, fontWeight: 600, pointerEvents: "none", whiteSpace: "nowrap", letterSpacing: "0.04em" }}
                            >
                                {lang === "tr" ? "Türkçe · EN" : "English · TR"}
                            </motion.span>
                        )}
                    </AnimatePresence>
                </button>
            </div>
        </motion.aside>
    );
}

function UpdateBanner() {
    const { available, version, installing, install, dismiss } = useUpdater();
    const { t } = useI18n();
    if (!available) return null;
    return (
        <div style={{
            position: "fixed", bottom: 24, right: 24, zIndex: 9999,
            background: "#1e1000", border: "1px solid rgba(212,146,10,0.35)",
            borderRadius: 12, padding: "12px 16px",
            display: "flex", alignItems: "center", gap: 12,
            boxShadow: "0 4px 24px rgba(0,0,0,0.5)",
            maxWidth: 320,
        }}>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#F5EDD6" }}>
                    {t("update.ready", { version: version ?? "" })}
                </div>
                <div style={{ fontSize: 12, color: "rgba(245,237,214,0.5)", marginTop: 2 }}>
                    {t("update.available")}
                </div>
            </div>
            <button
                onClick={install}
                disabled={installing}
                style={{
                    padding: "6px 12px", borderRadius: 7, border: "none",
                    background: "#D4920A", color: "#150b00",
                    fontSize: 12, fontWeight: 700, cursor: installing ? "default" : "pointer",
                    opacity: installing ? 0.6 : 1, flexShrink: 0,
                }}
            >
                {installing ? t("update.installing") : t("update.install")}
            </button>
            <button
                onClick={dismiss}
                style={{
                    background: "none", border: "none", color: "rgba(245,237,214,0.4)",
                    cursor: "pointer", fontSize: 16, padding: 0, lineHeight: 1, flexShrink: 0,
                }}
            >
                ×
            </button>
        </div>
    );
}

function AppShell() {
    return (
        <div style={{
            display: "flex",
            height: "100vh",
            background: "#150b00",
            color: "#F5EDD6",
            overflow: "hidden",
        }}>
            <Sidebar />
            <main style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>
                <Routes>
                    <Route path="/"           element={<Dashboard />} />
                    <Route path="/clean"      element={<CleanerPage />} />
                    <Route path="/analyze"    element={<AnalyzerPage />} />
                    <Route path="/apps"       element={<UninstallerPage />} />
                    <Route path="/startup"    element={<StartupPage />} />
                    <Route path="/duplicates" element={<DuplicatesPage />} />
                    <Route path="/trash"      element={<TrashPage />} />
                    <Route path="/ram"        element={<RamPage />} />
                    <Route path="/privacy"    element={<PrivacyPage />} />
                </Routes>
            </main>
        </div>
    );
}

export default function App() {
    return (
        <BrowserRouter>
            <AppShell />
            <ToastContainer />
            <UpdateBanner />
        </BrowserRouter>
    );
}
