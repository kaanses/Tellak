import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi, describe, it, expect, beforeEach } from "vitest";
import Dashboard from "../features/dashboard/Dashboard";
import { useAppStore } from "../shared/store";

vi.mock("@tauri-apps/api/core", () => ({
    invoke: vi.fn(() => Promise.resolve({})),
    convertFileSrc: (s: string) => s,
}));
vi.mock("@tauri-apps/api/event", () => ({
    listen: vi.fn(() => Promise.resolve(() => {})),
}));

const SYSTEM = {
    data: {
        CPU: { Usage: 20 },
        Memory: { UsedPercent: 50 },
        Disks: [{ UsedPercent: 60, Total: 500_000_000_000, Used: 300_000_000_000 }],
    },
    loading: false,
    error: null,
    lastFetched: Date.now(), // fresh, so fetchSystemStatus() no-ops and keeps this data
};

beforeEach(() => {
    useAppStore.setState({ systemStatus: SYSTEM });
});

describe("Dashboard scan-state persistence", () => {
    // Regression: navigating to an action page and back used to remount Dashboard
    // at local "idle" state, dropping the user on the hero screen. Scan state now
    // lives in the store, so a completed scan keeps the populated dashboard.
    it("renders the populated dashboard (not the hero) when the store has a done scan", () => {
        useAppStore.setState({
            junkScan: { state: "done", count: 12, total: 8_000_000_000, human: "8.0 GB" },
        });
        render(<MemoryRouter><Dashboard /></MemoryRouter>);

        expect(screen.getByText("Scan Complete")).toBeInTheDocument();
        expect(screen.getByText("8.0 GB")).toBeInTheDocument();        // junk total card
        expect(screen.getByRole("button", { name: /Rescan/ })).toBeInTheDocument();
    });

    it("shows the scan hero when the store scan state is idle", () => {
        useAppStore.setState({
            junkScan: { state: "idle", count: 0, total: 0, human: "" },
        });
        render(<MemoryRouter><Dashboard /></MemoryRouter>);

        expect(screen.queryByText("Scan Complete")).not.toBeInTheDocument();
    });
});
