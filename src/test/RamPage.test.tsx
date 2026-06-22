import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import RamPage from "../features/ram/RamPage";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({
    invoke: vi.fn(),
    convertFileSrc: (s: string) => s,
}));

const STATS = {
    total: 16_000_000_000,
    used: 8_000_000_000,
    available: 8_000_000_000,
    used_percent: 50,
    total_human: "16.0 GB",
    used_human: "8.0 GB",
    available_human: "7.5 GB",
};

beforeEach(() => {
    vi.mocked(invoke).mockReset();
});

describe("RamPage", () => {
    it("loads and renders RAM stats from the backend", async () => {
        vi.mocked(invoke).mockResolvedValue(STATS);
        render(<MemoryRouter><RamPage /></MemoryRouter>);

        expect(await screen.findByText("16.0 GB")).toBeInTheDocument();
        expect(screen.getByText("7.5 GB")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /Temizle/ })).toBeInTheDocument();
        expect(vi.mocked(invoke)).toHaveBeenCalledWith("get_ram_stats");
    });

    it("optimizes RAM and shows the freed amount on click", async () => {
        vi.mocked(invoke).mockImplementation((cmd: string) =>
            cmd === "optimize_ram" ? Promise.resolve("512 MB") : Promise.resolve(STATS)
        );
        render(<MemoryRouter><RamPage /></MemoryRouter>);

        const btn = await screen.findByRole("button", { name: /Temizle/ });
        fireEvent.click(btn);

        expect(await screen.findByText(/512 MB kurtarıldı/)).toBeInTheDocument();
        expect(vi.mocked(invoke)).toHaveBeenCalledWith("optimize_ram");
    });
});
