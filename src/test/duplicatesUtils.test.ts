import { vi, describe, it, expect } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

import {
  formatDate,
  formatBytes,
  pickKeeper,
  type DuplicateFile,
} from "../features/duplicates/DuplicatesPage";

// ── formatDate ────────────────────────────────────────────────────────────────

describe("formatDate", () => {
  it("returns empty string for falsy unix timestamp", () => {
    expect(formatDate(0)).toBe("");
  });

  it("formats a known timestamp and contains the year", () => {
    // Note: formatDate uses "tr-TR" locale. We only check for year presence
    // to avoid brittleness on CI environments with limited ICU data.
    const ts = Math.floor(new Date("2024-01-15T00:00:00Z").getTime() / 1000);
    const result = formatDate(ts);
    expect(result).toContain("2024");
  });

  it("returns a non-empty string for any positive timestamp", () => {
    expect(formatDate(1_700_000_000).length).toBeGreaterThan(0);
  });
});

// ── formatBytes ───────────────────────────────────────────────────────────────

describe("formatBytes", () => {
  it("handles zero", () => {
    expect(formatBytes(0)).toBe("0 B");
  });

  it("formats bytes under 1 KB", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1023)).toBe("1023 B");
  });

  it("formats kilobytes", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
  });

  it("formats megabytes", () => {
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
  });

  it("formats gigabytes with two decimals", () => {
    expect(formatBytes(1024 ** 3)).toBe("1.00 GB");
    expect(formatBytes(1024 ** 3 * 2.5)).toBe("2.50 GB");
  });
});

// ── pickKeeper ────────────────────────────────────────────────────────────────

function makeFile(path: string, modified: number): DuplicateFile {
  return { name: path.split("/").pop()!, path, size_human: "1 MB", modified };
}

describe("pickKeeper — newest strategy", () => {
  it("keeps the most recently modified file", () => {
    const files = [
      makeFile("/a/old.pdf", 1000),
      makeFile("/b/new.pdf", 2000),
      makeFile("/c/mid.pdf", 1500),
    ];
    expect(pickKeeper(files, "newest")).toBe("/b/new.pdf");
  });

  it("uses path as tiebreaker when timestamps are equal", () => {
    const files = [
      makeFile("/b/file.pdf", 1000),
      makeFile("/a/file.pdf", 1000),
    ];
    expect(pickKeeper(files, "newest")).toBe("/a/file.pdf");
  });

  it("returns empty string for empty array", () => {
    expect(pickKeeper([], "newest")).toBe("");
  });

  it("returns the only file when array has one item", () => {
    const files = [makeFile("/a/file.pdf", 999)];
    expect(pickKeeper(files, "newest")).toBe("/a/file.pdf");
  });
});

describe("pickKeeper — oldest strategy", () => {
  it("keeps the least recently modified file", () => {
    const files = [
      makeFile("/a/old.pdf", 1000),
      makeFile("/b/new.pdf", 2000),
    ];
    expect(pickKeeper(files, "oldest")).toBe("/a/old.pdf");
  });

  it("uses path tiebreaker (descending) when timestamps are equal", () => {
    const files = [
      makeFile("/a/file.pdf", 1000),
      makeFile("/b/file.pdf", 1000),
    ];
    expect(pickKeeper(files, "oldest")).toBe("/b/file.pdf");
  });
});

describe("pickKeeper — shallowest strategy", () => {
  it("keeps the file with the fewest path components", () => {
    const files = [
      makeFile("/a/b/c/deep.pdf", 1000),
      makeFile("/a/shallow.pdf", 1000),
      makeFile("/a/b/mid.pdf", 1000),
    ];
    expect(pickKeeper(files, "shallowest")).toBe("/a/shallow.pdf");
  });

  it("uses newest as tiebreaker when depths are equal", () => {
    const files = [
      makeFile("/a/old.pdf", 1000),
      makeFile("/b/new.pdf", 2000),
    ];
    expect(pickKeeper(files, "shallowest")).toBe("/b/new.pdf");
  });
});
