import { create } from 'zustand';
import { invoke as tauriInvoke } from '@tauri-apps/api/core';

const invoke = async <T>(cmd: string, args?: Record<string, unknown>): Promise<T> => {
    return tauriInvoke(cmd, args);
};

// ── Types ─────────────────────────────────────────────────────────────────────

interface SystemStatus {
    data: any | null;
    loading: boolean;
    error: string | null;
    lastFetched: number | null;
}

export type ScanState = "idle" | "scanning" | "done";

// Junk-scan results live in the store (not Dashboard-local state) so they
// survive navigating away to an action page (/clean, /ram, …) and back —
// otherwise the Dashboard remounts at "idle" and dumps the user on the hero
// screen instead of the populated dashboard they just scanned.
interface JunkScan {
    state: ScanState;
    count: number;   // categories reported so far (0–12)
    total: number;   // total junk bytes
    human: string;   // humanized total
}

interface AppState {
    systemStatus: SystemStatus;
    fetchSystemStatus: (force?: boolean) => Promise<void>;
    junkScan: JunkScan;
    setJunkScan: (update: Partial<JunkScan> | ((prev: JunkScan) => Partial<JunkScan>)) => void;
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useAppStore = create<AppState>((set, get) => ({
    systemStatus: {
        data: null,
        loading: false,
        error: null,
        lastFetched: null,
    },

    junkScan: { state: "idle", count: 0, total: 0, human: "" },

    setJunkScan: (update) =>
        set((s) => ({
            junkScan: {
                ...s.junkScan,
                ...(typeof update === "function" ? update(s.junkScan) : update),
            },
        })),

    fetchSystemStatus: async (force = false) => {
        const current = get().systemStatus;

        // Don't start a second fetch if one is already running
        if (current.loading) return;

        // Use cached data if it's less than 30 seconds old and not forced
        if (!force && current.data && current.lastFetched) {
            const age = Date.now() - current.lastFetched;
            if (age < 30_000) return;
        }

        set({ systemStatus: { ...current, loading: true, error: null } });

        try {
            const result = await invoke<any>('get_system_status');
            set({
                systemStatus: {
                    data: result,
                    loading: false,
                    error: null,
                    lastFetched: Date.now(),
                },
            });
        } catch (error) {
            set({
                systemStatus: {
                    ...get().systemStatus,
                    loading: false,
                    error: String(error),
                },
            });
        }
    },
}));
