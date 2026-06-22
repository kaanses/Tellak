use serde::Serialize;
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};
use tauri::Emitter;

// ── Types ─────────────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub size_human: String,
    pub is_dir: bool,
}

#[derive(Serialize)]
pub struct DirInfo {
    pub path: String,
    pub parent: Option<String>,
    pub entries: Vec<DirEntry>,
    pub total_size: u64,
    pub total_size_human: String,
    pub timed_out: bool, // true if du was killed early
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn humanize_bytes(bytes: u64) -> String {
    const UNITS: &[&str] = &["B", "KB", "MB", "GB", "TB"];
    if bytes == 0 { return "0 B".to_string(); }
    let mut size = bytes as f64;
    let mut idx = 0;
    while size >= 1024.0 && idx < UNITS.len() - 1 { size /= 1024.0; idx += 1; }
    if idx == 0 { format!("{} B", bytes) } else { format!("{:.1} {}", size, UNITS[idx]) }
}

/// Run `du -d1 -k <path>` with a timeout. Returns raw output (may be partial on timeout).
fn du_one_level(path: &str, timeout: Duration) -> (String, bool) {
    let mut child = match Command::new("du")
        .args(["-d", "1", "-k", path])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    {
        Ok(c) => c,
        Err(_) => return (String::new(), false),
    };

    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => {
                let out = child.wait_with_output().unwrap_or_else(|_| std::process::Output { status: std::process::ExitStatus::default(), stdout: vec![], stderr: vec![] });
                return (String::from_utf8_lossy(&out.stdout).to_string(), false);
            }
            Ok(None) => {
                if Instant::now() > deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    return (String::new(), true);
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(_) => return (String::new(), false),
        }
    }
}

fn parse_du_output(output: &str, root: &str) -> HashMap<String, u64> {
    let root_norm = root.trim_end_matches('/').to_string();
    let mut map = HashMap::new();
    for line in output.lines() {
        let mut parts = line.splitn(2, '\t');
        let kb: u64 = parts.next().unwrap_or("0").trim().parse().unwrap_or(0);
        let p = match parts.next() {
            Some(p) => p.trim().trim_end_matches('/').to_string(),
            None => continue,
        };
        if p == root_norm { continue; }
        map.insert(p, kb * 1024);
    }
    map
}

#[derive(Serialize)]
pub struct LargeFileEntry {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub size_human: String,
    pub ext: String,
}

/// Walk `root` using walkdir, collecting files >= min_bytes.
fn run_find_large(root: &str, min_bytes: u64) -> Vec<LargeFileEntry> {
    let mut entries: Vec<LargeFileEntry> = walkdir::WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .filter_map(|e| {
            let meta = e.metadata().ok()?;
            let size = meta.len();
            if size < min_bytes { return None; }
            let path_str = e.path().to_string_lossy().to_string();
            // Skip Trash
            if path_str.contains("/.Trash/") { return None; }
            let name = e.file_name().to_string_lossy().to_string();
            let ext = e.path()
                .extension()
                .map(|x| x.to_string_lossy().to_lowercase().to_string())
                .unwrap_or_default();
            Some(LargeFileEntry { name, path: path_str, size, size_human: humanize_bytes(size), ext })
        })
        .collect();

    entries.sort_by(|a, b| b.size.cmp(&a.size));
    entries.truncate(500);
    entries
}

// ── Commands ──────────────────────────────────────────────────────────────────

/// Returns the user's home directory path.
#[tauri::command]
pub fn get_home_path() -> String {
    std::env::var("HOME").unwrap_or_else(|_| "/Users/unknown".to_string())
}

/// Scans one directory level and returns entries sorted by size.
/// Uses `du -d1` for subdirectory sizes and `stat` for file sizes.
#[tauri::command]
pub async fn browse_directory(path: String) -> Result<DirInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let p = Path::new(&path);
        if !p.exists() {
            return Err(format!("Path does not exist: {}", path));
        }
        if !p.is_dir() {
            return Err(format!("Not a directory: {}", path));
        }

        let parent = p.parent()
            .filter(|pp| *pp != Path::new(""))
            .map(|pp| pp.to_string_lossy().to_string());

        // Run du -d1 with a generous timeout — home dirs with large projects can be slow
        let (du_out, timed_out) = du_one_level(&path, Duration::from_secs(60));
        let dir_sizes = parse_du_output(&du_out, &path);

        // Read directory entries
        let rd = std::fs::read_dir(p).map_err(|e| e.to_string())?;
        let mut entries: Vec<DirEntry> = Vec::new();

        for entry in rd.filter_map(|e| e.ok()) {
            let name = entry.file_name().to_string_lossy().to_string();
            // Skip hidden files/dirs
            if name.starts_with('.') { continue; }

            let entry_path = entry.path();
            let entry_path_str = entry_path.to_string_lossy().to_string();
            let meta = match entry.metadata() { Ok(m) => m, Err(_) => continue };
            let is_dir = meta.is_dir();

            let size = if is_dir {
                dir_sizes.get(&entry_path_str).copied().unwrap_or(0)
            } else {
                meta.len()
            };

            entries.push(DirEntry {
                name,
                path: entry_path_str,
                size,
                size_human: humanize_bytes(size),
                is_dir,
            });
        }

        entries.sort_by(|a, b| b.size.cmp(&a.size));
        let total_size: u64 = entries.iter().map(|e| e.size).sum();

        Ok(DirInfo {
            path,
            parent,
            entries,
            total_size,
            total_size_human: humanize_bytes(total_size),
            timed_out,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Finds all files in the home directory larger than `min_mb` megabytes.
/// Returns up to 500 results sorted by size descending. Partial results on timeout.
#[tauri::command]
pub async fn find_large_files(root: String, min_mb: u64) -> Result<Vec<LargeFileEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let min_bytes = min_mb.saturating_mul(1024 * 1024);
        Ok(run_find_large(&root, min_bytes))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── humanize_bytes ─────────────────────────────────────────────────────

    #[test]
    fn humanize_zero() {
        assert_eq!(humanize_bytes(0), "0 B");
    }

    #[test]
    fn humanize_kb() {
        assert_eq!(humanize_bytes(2048), "2.0 KB");
    }

    #[test]
    fn humanize_gb() {
        assert_eq!(humanize_bytes(1024u64.pow(3)), "1.0 GB");
    }

    // ── parse_du_output ────────────────────────────────────────────────────

    #[test]
    fn parse_du_basic() {
        let output = "128\t/Users/alice/Downloads/foo\n64\t/Users/alice/Downloads/bar\n256\t/Users/alice/Downloads\n";
        let map = parse_du_output(output, "/Users/alice/Downloads");
        // Root entry is skipped
        assert!(!map.contains_key("/Users/alice/Downloads"));
        // Children are present, converted from KB to bytes
        assert_eq!(map["/Users/alice/Downloads/foo"], 128 * 1024);
        assert_eq!(map["/Users/alice/Downloads/bar"], 64 * 1024);
    }

    #[test]
    fn parse_du_skips_root_with_trailing_slash() {
        let output = "256\t/Users/alice/Downloads/\n64\t/Users/alice/Downloads/bar\n";
        let map = parse_du_output(output, "/Users/alice/Downloads");
        assert!(!map.contains_key("/Users/alice/Downloads"));
        assert!(!map.contains_key("/Users/alice/Downloads/"));
        assert_eq!(map["/Users/alice/Downloads/bar"], 64 * 1024);
    }

    #[test]
    fn parse_du_empty_output() {
        let map = parse_du_output("", "/some/path");
        assert!(map.is_empty());
    }

    #[test]
    fn parse_du_malformed_no_tab() {
        // Line with no tab separator — parts.next() for path returns None, line is skipped
        let output = "badline\n128\t/some/path\n";
        let map = parse_du_output(output, "/other");
        assert!(map.contains_key("/some/path"));
        assert!(!map.contains_key("badline"));
    }
}

// ── Folder Tree ───────────────────────────────────────────────────────────────

#[derive(Serialize, Clone)]
pub struct TreeEntry {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub size_human: String,
    pub depth: u32,
}

#[derive(Serialize, Clone)]
pub struct TreeDone {
    pub timed_out: bool,
    pub total: u64,
}

#[derive(Serialize, Clone)]
pub struct TreeEntryBatch {
    pub entries: Vec<TreeEntry>,
}

fn parse_tree_line(line: &str, root_norm: &str, root_slash_count: usize) -> Option<TreeEntry> {
    let mut parts = line.splitn(2, '\t');
    let kb: u64 = parts.next().unwrap_or("0").trim().parse().unwrap_or(0);
    let entry_path = parts.next()?.trim().trim_end_matches('/').to_string();
    if entry_path == root_norm { return None; }
    let size = kb * 1024;
    if size < 512 * 1024 { return None; }
    let depth = (entry_path.chars().filter(|&c| c == '/').count()
        .saturating_sub(root_slash_count)) as u32;
    let name = entry_path.split('/').next_back().unwrap_or("").to_string();
    Some(TreeEntry { path: entry_path, name, size, size_human: humanize_bytes(size), depth })
}

/// Recursively scans `path` with `du -k`, streaming batches of directory sizes as
/// Tauri events ("tree_entries"). Emits "tree_done" when finished or timed out.
/// Only directories >= 512 KB are emitted to keep the result set manageable.
/// Entries are batched in groups of 50 to reduce IPC overhead.
#[tauri::command]
pub async fn scan_folder_tree(app: tauri::AppHandle, path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path_obj = Path::new(&path);
        if !path_obj.exists() {
            let _ = app.emit("tree_done", TreeDone { timed_out: false, total: 0 });
            return Err(format!("Path does not exist: {}", path));
        }

        let root_slash_count = path.chars().filter(|&c| c == '/').count();
        let root_norm = path.trim_end_matches('/').to_string();

        let mut child = match Command::new("du")
            .args(["-k", &path])
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
        {
            Ok(c) => c,
            Err(e) => {
                let _ = app.emit("tree_done", TreeDone { timed_out: false, total: 0 });
                return Err(e.to_string());
            }
        };

        let stdout = child.stdout.take().unwrap();
        let (tx, rx) = std::sync::mpsc::channel::<String>();
        let reader_handle = std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if tx.send(line).is_err() { break; }
            }
        });

        const BATCH_SIZE: usize = 50;
        let deadline = Instant::now() + Duration::from_secs(60);
        let mut timed_out = false;
        let mut total = 0u64;
        let mut batch: Vec<TreeEntry> = Vec::with_capacity(BATCH_SIZE);

        loop {
            while let Ok(line) = rx.try_recv() {
                if let Some(entry) = parse_tree_line(&line, &root_norm, root_slash_count) {
                    total += 1;
                    batch.push(entry);
                    if batch.len() >= BATCH_SIZE {
                        let _ = app.emit("tree_entries", TreeEntryBatch { entries: std::mem::take(&mut batch) });
                    }
                }
            }

            match child.try_wait() {
                Ok(Some(_)) => {
                    let _ = reader_handle.join(); // ensure all lines are in the channel
                    while let Ok(line) = rx.try_recv() {
                        if let Some(entry) = parse_tree_line(&line, &root_norm, root_slash_count) {
                            total += 1;
                            batch.push(entry);
                            if batch.len() >= BATCH_SIZE {
                                let _ = app.emit("tree_entries", TreeEntryBatch { entries: std::mem::take(&mut batch) });
                            }
                        }
                    }
                    if !batch.is_empty() {
                        let _ = app.emit("tree_entries", TreeEntryBatch { entries: std::mem::take(&mut batch) });
                    }
                    break;
                }
                Ok(None) => {
                    if Instant::now() > deadline {
                        let _ = child.kill();
                        let _ = child.wait();
                        if !batch.is_empty() {
                            let _ = app.emit("tree_entries", TreeEntryBatch { entries: std::mem::take(&mut batch) });
                        }
                        timed_out = true;
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(50));
                }
                Err(_) => {
                    if !batch.is_empty() {
                        let _ = app.emit("tree_entries", TreeEntryBatch { entries: std::mem::take(&mut batch) });
                    }
                    break;
                }
            }
        }

        let _ = app.emit("tree_done", TreeDone { timed_out, total });
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}
