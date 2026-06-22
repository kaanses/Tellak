use rayon::prelude::*;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::io::{BufReader, Read, Seek, SeekFrom};
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::SystemTime;
use tauri::Emitter;
use walkdir::WalkDir;

// ── Types ─────────────────────────────────────────────────────────────────────

#[derive(Serialize, Clone)]
pub struct DuplicateFile {
    pub name: String,
    pub path: String,
    pub size_human: String,
    pub modified: u64,
}

#[derive(Serialize, Clone)]
pub struct DuplicateGroup {
    pub size: u64,
    pub size_human: String,
    pub wasted: u64,
    pub wasted_human: String,
    pub files: Vec<DuplicateFile>,
}

#[derive(Serialize)]
pub struct DuplicateReport {
    pub groups: Vec<DuplicateGroup>,
    pub total_wasted: u64,
    pub total_wasted_human: String,
    pub files_scanned: u64,
}

#[derive(Serialize, Clone)]
struct DupProgress {
    phase: String,   // "walking" | "hashing" | "done"
    count: u64,      // files walked  OR  candidates being hashed
    total: u64,      // 0 during walking; total candidates during hashing
    current: String, // current file name for hashing phase
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn humanize_bytes(bytes: u64) -> String {
    const UNITS: &[&str] = &["B", "KB", "MB", "GB", "TB"];
    if bytes == 0 {
        return "0 B".to_string();
    }
    let mut size = bytes as f64;
    let mut idx = 0;
    while size >= 1024.0 && idx < UNITS.len() - 1 {
        size /= 1024.0;
        idx += 1;
    }
    if idx == 0 {
        format!("{} B", bytes)
    } else {
        format!("{:.1} {}", size, UNITS[idx])
    }
}

fn home_dir() -> PathBuf {
    std::env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("/Users/unknown"))
}

/// Returns true if the directory entry should be skipped entirely (not recursed).
fn should_skip_dir(name: &str) -> bool {
    if name.starts_with('.') {
        return true;
    }
    const SKIP_EXT: &[&str] = &[
        ".photoslibrary",
        ".musiclibrary",
        ".app",
        ".framework",
        ".bundle",
        ".plugin",
        ".kext",
        ".xcodeproj",
        ".xcworkspace",
        ".xcassets",
        ".scptd",
        ".sparsebundle",
        ".vmwarevm",
        ".parallels",
    ];
    const SKIP_NAME: &[&str] = &["node_modules", ".git", "target", ".Trash", ".npm", ".cargo"];

    SKIP_EXT.iter().any(|&e| name.ends_with(e)) || SKIP_NAME.contains(&name)
}

const CHUNK: usize = 64 * 1024;

/// Fast candidate screen: hash first+last 64 KB plus the file size.
fn quick_hash(path: &Path, size: u64) -> Option<String> {
    let mut file = std::fs::File::open(path).ok()?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; CHUNK];

    hasher.update(size.to_le_bytes());

    if size <= (CHUNK * 2) as u64 {
        let n = file.read(&mut buf).ok()?;
        hasher.update(&buf[..n]);
    } else {
        let n = file.read(&mut buf).ok()?;
        hasher.update(&buf[..n]);
        file.seek(SeekFrom::End(-(CHUNK as i64))).ok()?;
        let n = file.read(&mut buf).ok()?;
        hasher.update(&buf[..n]);
    }

    Some(format!("{:x}", hasher.finalize()))
}

/// Full SHA-256 — only called on files that already matched quick_hash.
fn full_hash(path: &Path) -> Option<String> {
    let file = std::fs::File::open(path).ok()?;
    let mut reader = BufReader::with_capacity(65536, file);
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 65536];
    loop {
        let n = reader.read(&mut buf).ok()?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Some(format!("{:x}", hasher.finalize()))
}

fn move_to_trash(path: &Path) -> Result<(), String> {
    let trash = home_dir().join(".Trash");
    let fname = path
        .file_name()
        .ok_or_else(|| "Invalid path".to_string())?
        .to_string_lossy()
        .to_string();

    let dst = {
        let candidate = trash.join(&fname);
        if candidate.exists() {
            let stem = path
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();
            let ext = path
                .extension()
                .map(|e| format!(".{}", e.to_string_lossy()))
                .unwrap_or_default();
            let ts = SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();
            trash.join(format!("{}_{}{}", stem, ts, ext))
        } else {
            candidate
        }
    };

    std::fs::rename(path, &dst).map_err(|e| e.to_string())
}

// ── Core scan ─────────────────────────────────────────────────────────────────

fn find_duplicates(app: tauri::AppHandle, roots: Vec<PathBuf>) -> DuplicateReport {
    const MIN_SIZE: u64 = 100 * 1024; // 100 KB — catches PDFs, images, docs
    const MAX_GROUP: usize = 200;

    // ── Phase 1: walk — group file paths by exact size ────────────────────────
    let mut size_map: HashMap<u64, Vec<PathBuf>> = HashMap::new();
    let mut files_scanned: u64 = 0;

    for root in &roots {
        if !root.exists() {
            continue;
        }
        for entry in WalkDir::new(root)
            .follow_links(false)
            .into_iter()
            .filter_entry(|e| {
                !e.file_type().is_dir()
                    || !should_skip_dir(&e.file_name().to_string_lossy())
            })
            .filter_map(|e| e.ok())
        {
            if !entry.file_type().is_file() {
                continue;
            }
            let meta = match entry.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };
            let size = meta.len();
            if size < MIN_SIZE {
                continue;
            }
            // Skip iCloud-evicted files — opening one triggers a download
            if meta.blocks() == 0 {
                continue;
            }
            files_scanned += 1;

            if files_scanned.is_multiple_of(100) {
                let name = entry.file_name().to_string_lossy().to_string();
                let _ = app.emit("dup_progress", DupProgress {
                    phase: "walking".into(),
                    count: files_scanned,
                    total: 0,
                    current: name,
                });
            }

            size_map.entry(size).or_default().push(entry.into_path());
        }
    }

    // ── Phase 2: parallel hashing ─────────────────────────────────────────────
    // Collect only size groups with 2–MAX_GROUP files
    let candidates: Vec<(u64, Vec<PathBuf>)> = size_map
        .into_iter()
        .filter(|(_, p)| p.len() >= 2 && p.len() <= MAX_GROUP)
        .collect();

    let total_candidates: u64 = candidates.iter().map(|(_, p)| p.len() as u64).sum();

    // Flatten into (size, path) pairs for parallel quick-hash
    let all_pairs: Vec<(u64, PathBuf)> = candidates
        .into_iter()
        .flat_map(|(size, paths)| paths.into_iter().map(move |p| (size, p)))
        .collect();

    let hashed = Arc::new(AtomicU64::new(0));
    let app_ref = &app;

    // Parallel quick-hash pass
    let quick_results: Vec<(u64, PathBuf, String)> = all_pairs
        .into_par_iter()
        .filter_map(|(size, path)| {
            let n = hashed.fetch_add(1, Ordering::Relaxed);
            if n.is_multiple_of(100) {
                let name = path
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default();
                let _ = app_ref.emit("dup_progress", DupProgress {
                    phase: "hashing".into(),
                    count: n,
                    total: total_candidates,
                    current: name,
                });
            }
            let hash = quick_hash(&path, size)?;
            Some((size, path, hash))
        })
        .collect();

    // Group quick-hash results by (size, hash)
    let mut quick_map: HashMap<(u64, String), Vec<PathBuf>> = HashMap::new();
    for (size, path, hash) in quick_results {
        quick_map.entry((size, hash)).or_default().push(path);
    }

    // Full-hash collisions in parallel
    let groups: Vec<DuplicateGroup> = quick_map
        .into_par_iter()
        .filter(|(_, paths)| paths.len() >= 2)
        .flat_map(|((size, _), paths)| {
            let mut full_map: HashMap<String, Vec<PathBuf>> = HashMap::new();
            for path in paths {
                if let Some(h) = full_hash(&path) {
                    full_map.entry(h).or_default().push(path);
                }
            }

            full_map
                .into_values()
                .filter(|dp| dp.len() >= 2)
                .filter_map(move |dup_paths| {
                    let mut files: Vec<DuplicateFile> = dup_paths
                        .iter()
                        .filter_map(|p| {
                            let meta = std::fs::metadata(p).ok()?;
                            let modified = meta
                                .modified()
                                .ok()
                                .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
                                .map(|d| d.as_secs())
                                .unwrap_or(0);
                            Some(DuplicateFile {
                                name: p
                                    .file_name()
                                    .map(|n| n.to_string_lossy().to_string())
                                    .unwrap_or_default(),
                                path: p.to_string_lossy().to_string(),
                                size_human: humanize_bytes(size),
                                modified,
                            })
                        })
                        .collect();

                    if files.len() < 2 {
                        return None;
                    }

                    files.sort_by(|a, b| b.modified.cmp(&a.modified));

                    let count = files.len() as u64;
                    let wasted = size * (count - 1);
                    Some(DuplicateGroup {
                        size,
                        size_human: humanize_bytes(size),
                        wasted,
                        wasted_human: humanize_bytes(wasted),
                        files,
                    })
                })
                .collect::<Vec<_>>()
        })
        .collect();

    let mut groups = groups;
    groups.sort_by(|a, b| b.wasted.cmp(&a.wasted));
    let total_wasted: u64 = groups.iter().map(|g| g.wasted).sum();

    let _ = app.emit("dup_progress", DupProgress {
        phase: "done".into(),
        count: hashed.load(Ordering::Relaxed),
        total: total_candidates,
        current: String::new(),
    });

    DuplicateReport {
        groups,
        total_wasted,
        total_wasted_human: humanize_bytes(total_wasted),
        files_scanned,
    }
}

// ── Commands ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn find_duplicate_files(
    app: tauri::AppHandle,
    roots: Vec<String>,
) -> Result<DuplicateReport, String> {
    let root_paths: Vec<PathBuf> = if roots.is_empty() {
        // Default: the six common user folders
        let home = home_dir();
        vec![
            home.join("Downloads"),
            home.join("Documents"),
            home.join("Desktop"),
            home.join("Pictures"),
            home.join("Movies"),
            home.join("Music"),
        ]
    } else {
        roots.into_iter().map(PathBuf::from).collect()
    };

    tauri::async_runtime::spawn_blocking(move || find_duplicates(app, root_paths))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn trash_duplicate_file(path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let p = Path::new(&path);
        if !p.exists() {
            return Ok(());
        }
        move_to_trash(p)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── should_skip_dir ────────────────────────────────────────────────────

    #[test]
    fn skip_hidden_dirs() {
        assert!(should_skip_dir(".git"));
        assert!(should_skip_dir(".DS_Store"));
        assert!(should_skip_dir(".npm"));
        assert!(should_skip_dir(".cargo"));
    }

    #[test]
    fn skip_named_dirs() {
        assert!(should_skip_dir("node_modules"));
        assert!(should_skip_dir("target"));
        assert!(should_skip_dir(".Trash"));
    }

    #[test]
    fn skip_extension_dirs() {
        assert!(should_skip_dir("MyApp.app"));
        assert!(should_skip_dir("MyLib.framework"));
        assert!(should_skip_dir("Plugin.bundle"));
        assert!(should_skip_dir("Extension.plugin"));
        assert!(should_skip_dir("Photos Library.photoslibrary"));
        assert!(should_skip_dir("iTunes Library.musiclibrary"));
        assert!(should_skip_dir("VM.vmwarevm"));
        assert!(should_skip_dir("macOS.parallels"));
    }

    #[test]
    fn allow_normal_dirs() {
        assert!(!should_skip_dir("Downloads"));
        assert!(!should_skip_dir("Documents"));
        assert!(!should_skip_dir("Pictures"));
        assert!(!should_skip_dir("MyProject"));
    }

    #[test]
    fn allow_dirs_that_share_prefix_with_skip_names() {
        // "target-dir" is NOT "target" (SKIP_NAME uses == comparison)
        assert!(!should_skip_dir("target-dir"));
    }
}
