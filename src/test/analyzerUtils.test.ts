import { vi } from "vitest";

// Mock Tauri APIs that don't exist in test environment
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

import { humanize, shortPath, getFileType } from "../features/analyzer/AnalyzerPage";

describe("humanize", () => {
  it("returns '0 B' for zero", () => {
    expect(humanize(0)).toBe("0 B");
  });

  it("formats bytes (< 1024) without decimal", () => {
    expect(humanize(512)).toBe("512 B");
    expect(humanize(1023)).toBe("1023 B");
  });

  it("formats kilobytes with one decimal", () => {
    expect(humanize(1024)).toBe("1.0 KB");
    expect(humanize(1536)).toBe("1.5 KB");
  });

  it("formats megabytes", () => {
    expect(humanize(1024 * 1024)).toBe("1.0 MB");
    expect(humanize(1024 * 1024 * 2.5)).toBe("2.5 MB");
  });

  it("formats gigabytes", () => {
    expect(humanize(1024 ** 3)).toBe("1.0 GB");
  });

  it("formats terabytes", () => {
    expect(humanize(1024 ** 4)).toBe("1.0 TB");
  });

  it("caps at TB (does not go to PB)", () => {
    const result = humanize(1024 ** 4 * 1024);
    expect(result).toMatch(/TB$/);
  });
});

describe("shortPath", () => {
  const home = "/Users/testuser";

  it("returns '~' for the home dir itself", () => {
    expect(shortPath(home, home)).toBe("~");
  });

  it("abbreviates paths under home", () => {
    expect(shortPath(`${home}/Downloads`, home)).toBe("~/Downloads");
    expect(shortPath(`${home}/Library/Caches/foo`, home)).toBe("~/Library/Caches/foo");
  });

  it("returns the path unchanged when outside home", () => {
    expect(shortPath("/Applications/Foo.app", home)).toBe("/Applications/Foo.app");
    expect(shortPath("/System/Library/bar", home)).toBe("/System/Library/bar");
  });

  it("does not confuse a path that starts with home as prefix but isn't under it", () => {
    expect(shortPath("/Users/testuserfoo/bar", home)).toBe("/Users/testuserfoo/bar");
  });
});

describe("getFileType", () => {
  it("identifies video extensions", () => {
    expect(getFileType("mp4")).toBe("video");
    expect(getFileType("mov")).toBe("video");
    expect(getFileType("mkv")).toBe("video");
  });

  it("is case-insensitive", () => {
    expect(getFileType("MP4")).toBe("video");
    expect(getFileType("PDF")).toBe("document");
  });

  it("identifies audio extensions", () => {
    expect(getFileType("mp3")).toBe("audio");
    expect(getFileType("flac")).toBe("audio");
  });

  it("identifies archive extensions", () => {
    expect(getFileType("zip")).toBe("archive");
    expect(getFileType("tar")).toBe("archive");
    expect(getFileType("7z")).toBe("archive");
  });

  it("identifies disk image extensions", () => {
    expect(getFileType("dmg")).toBe("disk");
    expect(getFileType("iso")).toBe("disk");
  });

  it("identifies document extensions", () => {
    expect(getFileType("pdf")).toBe("document");
    expect(getFileType("docx")).toBe("document");
  });

  it("returns 'other' for unknown extensions", () => {
    expect(getFileType("xyz")).toBe("other");
    expect(getFileType("")).toBe("other");
    expect(getFileType("exe")).toBe("other");
  });
});
