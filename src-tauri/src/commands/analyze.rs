use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant, SystemTime};
use tauri::Emitter;
use walkdir::WalkDir;

// ── Structs ─────────────────────────────────────────────────────────────────

#[derive(Serialize, Clone)]
pub struct JunkItem {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub size_human: String,
}

#[derive(Serialize, Clone)]
pub struct JunkCategory {
    pub id: String,
    pub name: String,
    pub description: String,
    pub size: u64,
    pub size_human: String,
    pub items: Vec<JunkItem>,
}

#[derive(Serialize, Clone)]
pub struct JunkReport {
    pub categories: Vec<JunkCategory>,
    pub total_size: u64,
    pub total_size_human: String,
}

// ── Helpers ──────────────────────────────────────────────────────────────────

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

fn run_with_timeout(program: &str, args: &[&str], timeout: Duration) -> Option<String> {
    let mut child = Command::new(program)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;

    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => {
                let out = child.wait_with_output().ok()?;
                return Some(String::from_utf8_lossy(&out.stdout).to_string());
            }
            Ok(None) => {
                if Instant::now() > deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    return None;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(_) => return None,
        }
    }
}

/// Single directory total via `du -sk`. Returns bytes.
fn dir_size_du(path: &Path, timeout: Duration) -> u64 {
    let p = path.to_string_lossy().to_string();
    run_with_timeout("du", &["-sk", &p], timeout)
        .and_then(|s| s.split_whitespace().next().and_then(|kb| kb.parse::<u64>().ok()))
        .unwrap_or(0)
        * 1024
}

/// Per-child sizes via `du -d 1 -k <parent>`. Returns items sorted by size desc.
/// Ideal for directories that contain subdirectories (Caches, Logs).
fn scan_dir_children(parent: &Path, timeout: Duration) -> Vec<JunkItem> {
    if !parent.exists() {
        return vec![];
    }
    let p = parent.to_string_lossy().to_string();
    let output = match run_with_timeout("du", &["-d", "1", "-k", &p], timeout) {
        Some(o) => o,
        None => return vec![],
    };

    let target_norm = p.trim_end_matches('/').to_string();
    let mut items: Vec<JunkItem> = Vec::new();

    for line in output.lines() {
        let mut parts = line.splitn(2, '\t');
        let size_kb: u64 = parts.next().unwrap_or("0").trim().parse().unwrap_or(0);
        let raw = match parts.next() {
            Some(p) => p.trim(),
            None => continue,
        };
        let path_str = raw.trim_end_matches('/').to_string();
        if path_str == target_norm || size_kb == 0 {
            continue;
        }
        let name = PathBuf::from(&path_str)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| path_str.clone());

        let size = size_kb * 1024;
        items.push(JunkItem {
            name,
            path: path_str,
            size,
            size_human: humanize_bytes(size),
        });
    }

    items.sort_by(|a, b| b.size.cmp(&a.size));
    items.truncate(15);
    items
}

/// Sizes for a named list of paths, each scanned in parallel via `du -sk`.
/// Ideal for browser caches, dev tools, etc.
fn scan_named_paths(paths: Vec<(String, PathBuf)>, timeout: Duration) -> Vec<JunkItem> {
    let handles: Vec<_> = paths
        .into_iter()
        .filter(|(_, p)| p.exists())
        .map(|(name, path)| {
            thread::spawn(move || -> Option<JunkItem> {
                let size = dir_size_du(&path, timeout);
                if size == 0 {
                    return None;
                }
                Some(JunkItem {
                    name,
                    path: path.to_string_lossy().to_string(),
                    size,
                    size_human: humanize_bytes(size),
                })
            })
        })
        .collect();

    let mut items: Vec<JunkItem> = handles
        .into_iter()
        .filter_map(|h| h.join().ok().flatten())
        .collect();
    items.sort_by(|a, b| b.size.cmp(&a.size));
    items
}

fn make_category(id: &str, name: &str, desc: &str, items: Vec<JunkItem>) -> JunkCategory {
    let size: u64 = items.iter().map(|i| i.size).sum();
    JunkCategory {
        id: id.to_string(),
        name: name.to_string(),
        description: desc.to_string(),
        size,
        size_human: humanize_bytes(size),
        items,
    }
}

fn dirs_home() -> PathBuf {
    std::env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("/Users/unknown"))
}

// ── Language file helpers ─────────────────────────────────────────────────────

/// Parse `defaults read -g AppleLanguages` and return a deduplicated list of
/// language codes the user wants to keep (e.g. ["en-US", "en", "tr-TR", "tr",
/// "Base", "English"]).
fn get_keep_languages() -> Vec<String> {
    let raw = run_with_timeout(
        "defaults",
        &["read", "-g", "AppleLanguages"],
        Duration::from_secs(5),
    )
    .unwrap_or_default();

    let mut langs: Vec<String> = Vec::new();
    let mut in_quote = false;
    let mut current = String::new();

    for ch in raw.chars() {
        match ch {
            '"' => {
                if in_quote && !current.is_empty() {
                    let t = current.trim().to_string();
                    if !langs.contains(&t) {
                        langs.push(t.clone());
                    }
                    // Also keep the base language without region ("en-US" → "en")
                    if let Some(base) = t.split(['-', '_']).next() {
                        let base = base.to_string();
                        if !langs.contains(&base) {
                            langs.push(base);
                        }
                    }
                    current.clear();
                }
                in_quote = !in_quote;
            }
            c if in_quote => current.push(c),
            _ => {}
        }
    }

    // Always preserve universal fallbacks every app ships
    for always in &["Base", "en", "English"] {
        let s = always.to_string();
        if !langs.contains(&s) {
            langs.push(s);
        }
    }

    langs
}

/// Collect all .app bundles from /Applications and ~/Applications.
fn find_app_dirs(home: &Path) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    for root in &[PathBuf::from("/Applications"), home.join("Applications")] {
        let rd = match std::fs::read_dir(root) {
            Ok(r) => r,
            Err(_) => continue,
        };
        for entry in rd.filter_map(|e| e.ok()) {
            let path = entry.path();
            if path.extension().map(|e| e == "app").unwrap_or(false) {
                dirs.push(path);
            }
        }
    }
    dirs
}

/// Returns true if this lproj language code should be kept.
/// Handles en vs en-US, zh-Hans vs zh, etc.
fn should_keep_lproj(lang: &str, keep: &[String]) -> bool {
    keep.iter().any(|k| {
        let k = k.to_lowercase();
        let l = lang.to_lowercase();
        k == l
            || l.starts_with(&format!("{}-", k))
            || l.starts_with(&format!("{}_", k))
            || k.starts_with(&format!("{}-", l))
            || k.starts_with(&format!("{}_", l))
    })
}

/// Scan one app bundle for removable .lproj directories.
/// Uses a single `du -d1 -k` call on Contents/Resources — fast.
fn find_removable_lproj(app_path: &Path, keep_langs: &[String]) -> Vec<JunkItem> {
    let resources = app_path.join("Contents/Resources");
    if !resources.exists() {
        return vec![];
    }

    // Stronger write-test: create and immediately delete a temp directory.
    // We need directory-deletion permission (rm -rf on .lproj dirs), which is
    // stricter than file creation. Safari and other SIP-adjacent apps allow
    // file creation in Resources but block directory removal — testing with a
    // directory catches those cases and prevents false positives in the scan.
    let test_dir = resources.join(".tellak_test_dir");
    match std::fs::create_dir(&test_dir) {
        Ok(_) => { let _ = std::fs::remove_dir(&test_dir); }
        Err(_) => return vec![],
    }

    let app_name = app_path
        .file_stem()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();

    let res_str = resources.to_string_lossy().to_string();
    let output = run_with_timeout("du", &["-d", "1", "-k", &res_str], Duration::from_secs(15))
        .unwrap_or_default();

    let res_norm = res_str.trim_end_matches('/').to_string();
    let mut items = Vec::new();

    for line in output.lines() {
        let mut parts = line.splitn(2, '\t');
        let size_kb: u64 = parts.next().unwrap_or("0").trim().parse().unwrap_or(0);
        let path_str = match parts.next() {
            Some(p) => p.trim().trim_end_matches('/').to_string(),
            None => continue,
        };
        if path_str == res_norm || size_kb == 0 {
            continue;
        }

        let fname = PathBuf::from(&path_str)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();

        if !fname.ends_with(".lproj") {
            continue;
        }

        let lang = fname.trim_end_matches(".lproj");
        if should_keep_lproj(lang, keep_langs) {
            continue;
        }

        let size = size_kb * 1024;
        items.push(JunkItem {
            name: format!("{} — {}", app_name, lang),
            path: path_str,
            size,
            size_human: humanize_bytes(size),
        });
    }

    items
}

fn scan_language_files(home: PathBuf) -> JunkCategory {
    let keep_langs = get_keep_languages();
    let app_dirs = find_app_dirs(&home);

    // One thread per app (each does one `du` call) — I/O bound, parallelises well
    let handles: Vec<_> = app_dirs
        .into_iter()
        .map(|app_path| {
            let keep = keep_langs.clone();
            thread::spawn(move || find_removable_lproj(&app_path, &keep))
        })
        .collect();

    let mut items: Vec<JunkItem> = handles
        .into_iter()
        .filter_map(|h| h.join().ok())
        .flatten()
        .collect();

    items.sort_by(|a, b| b.size.cmp(&a.size));

    make_category(
        "language_files",
        "Language Files",
        "Unused language packs in app bundles — safe to remove",
        items,
    )
}

// ── New scan functions ────────────────────────────────────────────────────────

const LARGE_FILE_MIN_SIZE: u64 = 50 * 1024 * 1024; // 50 MB
const LARGE_FILE_SKIP_DIRS: &[&str] = &["node_modules", ".git", "target", ".npm", ".cargo"];

fn large_file_roots(home: &Path) -> Vec<PathBuf> {
    vec![
        home.join("Downloads"),
        home.join("Documents"),
        home.join("Desktop"),
        home.join("Movies"),
        home.join("Music"),
        home.join("Pictures"),
    ]
}

/// True if any path component is a directory we never surface large files from
/// (dev caches, vcs internals). Cheap segment scan — no allocation per check.
fn in_skip_dir(path: &str) -> bool {
    path.split('/')
        .any(|seg| LARGE_FILE_SKIP_DIRS.contains(&seg))
}

fn make_large_item(path: &str, size: u64) -> JunkItem {
    let name = Path::new(path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string());
    JunkItem {
        name,
        path: path.to_string(),
        size,
        size_human: humanize_bytes(size),
    }
}

/// Fast path: query Spotlight's pre-built index for 50 MB+ files instead of
/// walking the filesystem. Near-instant regardless of how many files live on
/// Desktop/Documents. Returns None only if `mdfind` can't be spawned at all
/// (Spotlight disabled / not installed) so the caller can fall back to WalkDir.
fn scan_large_files_mdfind(roots: &[PathBuf]) -> Option<Vec<JunkItem>> {
    let query = format!("kMDItemFSSize > {}", LARGE_FILE_MIN_SIZE);
    let mut items: Vec<JunkItem> = Vec::new();
    let mut spawned_any = false;

    for root in roots {
        if !root.exists() {
            continue;
        }
        let root_str = root.to_string_lossy().to_string();
        let out = match run_with_timeout(
            "mdfind",
            &["-onlyin", &root_str, &query],
            Duration::from_secs(8),
        ) {
            Some(o) => o,
            // Timeout/kill on one root: keep what we have, skip this root.
            None => continue,
        };
        spawned_any = true;

        for line in out.lines() {
            let path = line.trim();
            if path.is_empty() || in_skip_dir(path) {
                continue;
            }
            // Spotlight size can be stale; confirm with a real stat.
            let size = match std::fs::metadata(path) {
                Ok(m) if m.is_file() => m.len(),
                _ => continue,
            };
            if size < LARGE_FILE_MIN_SIZE {
                continue;
            }
            items.push(make_large_item(path, size));
        }
    }

    if spawned_any {
        Some(items)
    } else {
        None
    }
}

/// Fallback path: original WalkDir traversal, used only when Spotlight is
/// unavailable. Bounded by a 30 s deadline so a giant Desktop can't hang it.
fn scan_large_files_walk(roots: &[PathBuf]) -> Vec<JunkItem> {
    let deadline = Instant::now() + Duration::from_secs(30);
    let mut items: Vec<JunkItem> = Vec::new();

    'outer: for root in roots {
        if !root.exists() {
            continue;
        }
        for entry in WalkDir::new(root)
            .follow_links(false)
            .into_iter()
            .filter_entry(|e| {
                let name = e.file_name().to_string_lossy();
                !LARGE_FILE_SKIP_DIRS.iter().any(|&s| s == name.as_ref())
            })
            .filter_map(|e| e.ok())
        {
            if Instant::now() >= deadline {
                break 'outer;
            }
            if !entry.file_type().is_file() {
                continue;
            }
            let size = match entry.metadata() {
                Ok(m) => m.len(),
                Err(_) => continue,
            };
            if size < LARGE_FILE_MIN_SIZE {
                continue;
            }
            items.push(make_large_item(&entry.path().to_string_lossy(), size));
        }
    }
    items
}

fn scan_large_files(home: PathBuf) -> JunkCategory {
    let roots = large_file_roots(&home);

    let mut items = scan_large_files_mdfind(&roots)
        .unwrap_or_else(|| scan_large_files_walk(&roots));

    items.sort_by(|a, b| b.size.cmp(&a.size));
    items.truncate(30);
    make_category(
        "large_files",
        "Large Files",
        "Files over 50 MB in Downloads, Documents, Desktop, Movies, Music, Pictures",
        items,
    )
}

fn scan_old_downloads(home: PathBuf) -> JunkCategory {
    const DAYS_90: u64 = 90 * 24 * 60 * 60;
    let skip_ext = [".download", ".crdownload", ".part"];
    let downloads = home.join("Downloads");

    if !downloads.exists() {
        return make_category(
            "old_downloads",
            "Old Downloads",
            "Files in ~/Downloads not modified in 90+ days",
            vec![],
        );
    }

    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    // (mtime_secs, JunkItem) — sorted oldest-first at the end
    let mut items: Vec<(u64, JunkItem)> = Vec::new();

    for entry in WalkDir::new(&downloads)
        .max_depth(3)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        if !entry.file_type().is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if skip_ext.iter().any(|&ext| name.ends_with(ext)) {
            continue;
        }
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let mtime = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(now);

        let age_secs = now.saturating_sub(mtime);
        if age_secs < DAYS_90 {
            continue;
        }

        let size = meta.len();
        let days = age_secs / 86400;
        let path = entry.path();

        items.push((
            mtime,
            JunkItem {
                name: format!("{} ({}d old)", name, days),
                path: path.to_string_lossy().to_string(),
                size,
                size_human: humanize_bytes(size),
            },
        ));
    }

    items.sort_by(|a, b| a.0.cmp(&b.0)); // oldest first
    items.truncate(30);
    let junk_items: Vec<JunkItem> = items.into_iter().map(|(_, item)| item).collect();

    make_category(
        "old_downloads",
        "Old Downloads",
        "Files in ~/Downloads not modified in 90+ days",
        junk_items,
    )
}

fn scan_snapshots() -> JunkCategory {
    let output = run_with_timeout("tmutil", &["listlocalsnapshots", "/"], Duration::from_secs(10))
        .unwrap_or_default();

    // tmutil output starts with a header like "Snapshots for disk /:"
    // Only include Time Machine snapshots (com.apple.TimeMachine.*).
    // com.apple.os.update-* are SIP-protected system update snapshots that
    // cannot be deleted by tmutil even with admin — skip them entirely.
    let items: Vec<JunkItem> = output
        .lines()
        .map(|l| l.trim())
        .filter(|l| l.starts_with("com.apple.TimeMachine."))
        .map(|name| JunkItem {
            name: name.to_string(),
            path: name.to_string(), // snapshot identifier used by tmutil deletelocalsnapshot
            size: 1, // placeholder — actual size not accessible without root
            size_human: "size varies".to_string(),
        })
        .collect();

    let count = items.len();
    JunkCategory {
        id: "snapshots".to_string(),
        name: "APFS Snapshots".to_string(),
        description: format!(
            "{} local Time Machine snapshot{} — may reclaim significant disk space",
            count,
            if count == 1 { "" } else { "s" }
        ),
        size: count as u64, // non-zero so category appears; not a real byte count
        size_human: if count > 0 {
            format!("{} snapshot{}", count, if count == 1 { "" } else { "s" })
        } else {
            "0 B".to_string()
        },
        items,
    }
}

// ── Scan ─────────────────────────────────────────────────────────────────────

fn scan_junk() -> Result<JunkReport, String> {
    let home = dirs_home();
    let lib = home.join("Library");

    // Each category runs in its own thread — total time ≈ slowest category, not sum.

    let h_caches = {
        let path = lib.join("Caches");
        thread::spawn(move || {
            const EXCLUDE: &[&str] = &[
                "com.apple.Safari", "Google", "Firefox", "com.microsoft.edgemac",
                "company.thebrowser.Browser", "BraveSoftware", "com.operasoftware.Opera",
                "com.vivaldi.Vivaldi", "zen", "com.kagi.kagimacOS",
                "CocoaPods", "pip", "Homebrew", "com.docker.docker",
            ];
            let items = scan_dir_children(&path, Duration::from_secs(30))
                .into_iter()
                .filter(|item| {
                    let name = std::path::Path::new(&item.path)
                        .file_name()
                        .map(|n| n.to_string_lossy())
                        .unwrap_or_default();
                    !EXCLUDE.iter().any(|&ex| name == ex)
                })
                .collect::<Vec<_>>();
            make_category("caches", "App Caches", "Per-app cached data in ~/Library/Caches", items)
        })
    };

    let h_browsers = {
        let lib = lib.clone();
        thread::spawn(move || {
            let paths = vec![
                ("Safari".to_string(),  lib.join("Caches/com.apple.Safari")),
                ("Chrome".to_string(),  lib.join("Caches/Google/Chrome")),
                ("Firefox".to_string(), lib.join("Caches/Firefox")),
                ("Edge".to_string(),    lib.join("Caches/com.microsoft.edgemac")),
                ("Arc".to_string(),     lib.join("Caches/company.thebrowser.Browser")),
                ("Brave".to_string(),   lib.join("Caches/BraveSoftware/Brave-Browser")),
                ("Opera".to_string(),   lib.join("Caches/com.operasoftware.Opera")),
                ("Vivaldi".to_string(), lib.join("Caches/com.vivaldi.Vivaldi")),
                ("Zen".to_string(),     lib.join("Caches/zen")),
                ("Orion".to_string(),   lib.join("Caches/com.kagi.kagimacOS")),
            ];
            make_category(
                "browsers",
                "Browser Caches",
                "Cached web data from installed browsers",
                scan_named_paths(paths, Duration::from_secs(20)),
            )
        })
    };

    let h_logs = {
        let path = lib.join("Logs");
        thread::spawn(move || {
            make_category(
                "logs",
                "App Logs",
                "Log files stored by apps in ~/Library/Logs",
                scan_dir_children(&path, Duration::from_secs(20)),
            )
        })
    };

    let h_dev = {
        let home = home.clone();
        let lib = lib.clone();
        thread::spawn(move || {
            let paths = vec![
                ("Xcode DerivedData".to_string(),  lib.join("Developer/Xcode/DerivedData")),
                ("Xcode Archives".to_string(),     lib.join("Developer/Xcode/Archives")),
                ("iOS Simulators".to_string(),     lib.join("Developer/CoreSimulator/Caches")),
                ("npm".to_string(),                home.join(".npm/_cacache")),
                ("yarn".to_string(),               home.join(".yarn/cache")),
                ("pnpm".to_string(),               home.join(".pnpm-store")),
                ("Cargo registry".to_string(),     home.join(".cargo/registry/cache")),
                ("Gradle".to_string(),             home.join(".gradle/caches")),
                ("CocoaPods".to_string(),          lib.join("Caches/CocoaPods")),
                ("pip".to_string(),                lib.join("Caches/pip")),
                ("Homebrew".to_string(),           home.join("Library/Caches/Homebrew")),
                ("bun".to_string(),                home.join(".bun/install/cache")),
                ("Docker".to_string(),             lib.join("Caches/com.docker.docker")),
                ("Maven".to_string(),              home.join(".m2/repository")),
                ("Ruby Gems".to_string(),          home.join(".gem")),
            ];
            make_category(
                "dev",
                "Developer Tools",
                "Build artifacts and package manager caches",
                scan_named_paths(paths, Duration::from_secs(30)),
            )
        })
    };

    let h_trash = {
        let path = home.join(".Trash");
        thread::spawn(move || {
            make_category(
                "trash",
                "Trash",
                "Files waiting to be permanently deleted",
                scan_named_paths(
                    vec![("Trash".to_string(), path)],
                    Duration::from_secs(20),
                ),
            )
        })
    };

    let h_ios = {
        let path = lib.join("Application Support/MobileSync/Backup");
        thread::spawn(move || {
            make_category(
                "ios",
                "iOS Backups",
                "iPhone and iPad backups stored on this Mac",
                scan_dir_children(&path, Duration::from_secs(30)),
            )
        })
    };

    let h_diagnostics = {
        let path = lib.join("DiagnosticReports");
        thread::spawn(move || {
            make_category(
                "diagnostics",
                "Diagnostic Reports",
                "App crash logs and system diagnostic data",
                scan_named_paths(
                    vec![("Diagnostic Reports".to_string(), path)],
                    Duration::from_secs(10),
                ),
            )
        })
    };

    let h_saved = {
        let path = lib.join("Saved Application State");
        thread::spawn(move || {
            make_category(
                "saved_states",
                "Saved App States",
                "Window restore data saved by macOS for every app",
                scan_named_paths(
                    vec![("Saved States".to_string(), path)],
                    Duration::from_secs(10),
                ),
            )
        })
    };

    let h_lang = {
        let home = home.clone();
        thread::spawn(move || scan_language_files(home))
    };

    let h_large = {
        let home = home.clone();
        thread::spawn(move || scan_large_files(home))
    };

    let h_old_dl = {
        let home = home.clone();
        thread::spawn(move || scan_old_downloads(home))
    };

    let h_snapshots = thread::spawn(scan_snapshots);

    // Collect — all threads have been running in parallel since spawn.
    let mut categories: Vec<JunkCategory> = [
        h_caches,
        h_browsers,
        h_logs,
        h_dev,
        h_trash,
        h_ios,
        h_diagnostics,
        h_saved,
        h_lang,
        h_large,
        h_old_dl,
        h_snapshots,
    ]
    .into_iter()
    .filter_map(|h| h.join().ok())
    .filter(|c| c.size > 0)
    .collect();

    categories.sort_by(|a, b| b.size.cmp(&a.size));
    let total_size: u64 = categories.iter().map(|c| c.size).sum();

    Ok(JunkReport {
        categories,
        total_size,
        total_size_human: humanize_bytes(total_size),
    })
}

// ── Result cache ──────────────────────────────────────────────────────────────

/// Cached junk scan result with the time it was computed.
/// Re-used for 5 minutes to avoid re-scanning on every page visit.
static JUNK_CACHE: Mutex<Option<(JunkReport, Instant)>> = Mutex::new(None);

const CACHE_TTL: Duration = Duration::from_secs(300); // 5 minutes

/// Returns the total junk bytes from the last scan, if one has been run.
/// Used by the health score calculator in status.rs.
pub fn get_cached_junk_total() -> Option<u64> {
    JUNK_CACHE
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
        .map(|(r, _)| r.total_size)
}

/// Clears the junk cache after a clean operation so the health score
/// immediately drops the junk penalty without waiting for a re-scan.
pub fn clear_junk_cache() {
    *JUNK_CACHE.lock().unwrap_or_else(|e| e.into_inner()) = None;
}

// ── Tauri command ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn analyze_junk(force: bool) -> Result<JunkReport, String> {
    // Return cached result if it's still fresh and force isn't requested
    if !force {
        let guard = JUNK_CACHE.lock().unwrap_or_else(|e| e.into_inner());
        if let Some((ref report, ref at)) = *guard {
            if at.elapsed() < CACHE_TTL {
                return Ok(report.clone());
            }
        }
    }

    let report = tauri::async_runtime::spawn_blocking(scan_junk)
        .await
        .map_err(|e| e.to_string())??;

    // Store fresh result in cache
    *JUNK_CACHE.lock().unwrap_or_else(|e| e.into_inner()) = Some((report.clone(), Instant::now()));

    Ok(report)
}

// ── Streaming scan ────────────────────────────────────────────────────────────

#[derive(Serialize, Clone)]
struct JunkScanDone {
    total_size: u64,
    total_size_human: String,
}

/// Scans all junk categories in parallel threads and emits a `junk_category`
/// event for each one as it finishes (so the UI can show results one-by-one).
/// Emits `junk_scan_done` with the total when all threads have completed.
/// Uses the same 5-minute cache as `analyze_junk`.
#[tauri::command]
pub async fn scan_junk_streaming(app: tauri::AppHandle, force: bool) -> Result<(), String> {
    // Serve from cache if fresh
    if !force {
        let guard = JUNK_CACHE.lock().unwrap_or_else(|e| e.into_inner());
        if let Some((ref report, ref at)) = *guard {
            if at.elapsed() < CACHE_TTL {
                for cat in &report.categories {
                    let _ = app.emit("junk_category", cat);
                }
                let _ = app.emit("junk_scan_done", JunkScanDone {
                    total_size: report.total_size,
                    total_size_human: report.total_size_human.clone(),
                });
                return Ok(());
            }
        }
    }

    tauri::async_runtime::spawn_blocking(move || stream_scan_junk(app))
        .await
        .map_err(|e| e.to_string())?
}

fn stream_scan_junk(app: tauri::AppHandle) -> Result<(), String> {
    let home = dirs_home();
    let lib = home.join("Library");

    let (tx, rx) = std::sync::mpsc::channel::<JunkCategory>();

    // ── Spawn one thread per category (each gets its own tx clone + path clone) ─
    let _h_caches = {
        let tx = tx.clone();
        let path = lib.join("Caches");
        thread::spawn(move || {
            // Exclude dirs already covered by "Browser Caches" and "Developer Tools"
            // so the same folder doesn't appear in two categories at once.
            const EXCLUDE: &[&str] = &[
                // browsers
                "com.apple.Safari", "Google", "Firefox", "com.microsoft.edgemac",
                "company.thebrowser.Browser", "BraveSoftware", "com.operasoftware.Opera",
                "com.vivaldi.Vivaldi", "zen", "com.kagi.kagimacOS",
                // dev tools
                "CocoaPods", "pip", "Homebrew", "com.docker.docker",
            ];
            let items = scan_dir_children(&path, Duration::from_secs(30))
                .into_iter()
                .filter(|item| {
                    let name = std::path::Path::new(&item.path)
                        .file_name()
                        .map(|n| n.to_string_lossy())
                        .unwrap_or_default();
                    !EXCLUDE.iter().any(|&ex| name == ex)
                })
                .collect::<Vec<_>>();
            let _ = tx.send(make_category("caches", "App Caches", "Per-app cached data in ~/Library/Caches", items));
        })
    };

    let _h_browsers = {
        let tx = tx.clone();
        let lib = lib.clone();
        thread::spawn(move || {
            let paths = vec![
                ("Safari".to_string(),  lib.join("Caches/com.apple.Safari")),
                ("Chrome".to_string(),  lib.join("Caches/Google/Chrome")),
                ("Firefox".to_string(), lib.join("Caches/Firefox")),
                ("Edge".to_string(),    lib.join("Caches/com.microsoft.edgemac")),
                ("Arc".to_string(),     lib.join("Caches/company.thebrowser.Browser")),
                ("Brave".to_string(),   lib.join("Caches/BraveSoftware/Brave-Browser")),
                ("Opera".to_string(),   lib.join("Caches/com.operasoftware.Opera")),
                ("Vivaldi".to_string(), lib.join("Caches/com.vivaldi.Vivaldi")),
                ("Zen".to_string(),     lib.join("Caches/zen")),
                ("Orion".to_string(),   lib.join("Caches/com.kagi.kagimacOS")),
            ];
            let _ = tx.send(make_category("browsers", "Browser Caches", "Cached web data from installed browsers",
                scan_named_paths(paths, Duration::from_secs(20))));
        })
    };

    let _h_logs = {
        let tx = tx.clone();
        let path = lib.join("Logs");
        thread::spawn(move || {
            let _ = tx.send(make_category("logs", "App Logs", "Log files stored by apps in ~/Library/Logs",
                scan_dir_children(&path, Duration::from_secs(20))));
        })
    };

    let _h_dev = {
        let tx = tx.clone();
        let home = home.clone();
        let lib = lib.clone();
        thread::spawn(move || {
            let paths = vec![
                ("Xcode DerivedData".to_string(),  lib.join("Developer/Xcode/DerivedData")),
                ("Xcode Archives".to_string(),     lib.join("Developer/Xcode/Archives")),
                ("iOS Simulators".to_string(),     lib.join("Developer/CoreSimulator/Caches")),
                ("npm".to_string(),                home.join(".npm/_cacache")),
                ("yarn".to_string(),               home.join(".yarn/cache")),
                ("pnpm".to_string(),               home.join(".pnpm-store")),
                ("Cargo registry".to_string(),     home.join(".cargo/registry/cache")),
                ("Gradle".to_string(),             home.join(".gradle/caches")),
                ("CocoaPods".to_string(),          lib.join("Caches/CocoaPods")),
                ("pip".to_string(),                lib.join("Caches/pip")),
                ("Homebrew".to_string(),           home.join("Library/Caches/Homebrew")),
                ("bun".to_string(),                home.join(".bun/install/cache")),
                ("Docker".to_string(),             lib.join("Caches/com.docker.docker")),
                ("Maven".to_string(),              home.join(".m2/repository")),
                ("Ruby Gems".to_string(),          home.join(".gem")),
            ];
            let _ = tx.send(make_category("dev", "Developer Tools", "Build artifacts and package manager caches",
                scan_named_paths(paths, Duration::from_secs(30))));
        })
    };

    let _h_trash = {
        let tx = tx.clone();
        let path = home.join(".Trash");
        thread::spawn(move || {
            let _ = tx.send(make_category("trash", "Trash", "Files waiting to be permanently deleted",
                scan_named_paths(vec![("Trash".to_string(), path)], Duration::from_secs(20))));
        })
    };

    let _h_ios = {
        let tx = tx.clone();
        let path = lib.join("Application Support/MobileSync/Backup");
        thread::spawn(move || {
            let _ = tx.send(make_category("ios", "iOS Backups", "iPhone and iPad backups stored on this Mac",
                scan_dir_children(&path, Duration::from_secs(30))));
        })
    };

    let _h_diagnostics = {
        let tx = tx.clone();
        let path = lib.join("DiagnosticReports");
        thread::spawn(move || {
            let _ = tx.send(make_category("diagnostics", "Diagnostic Reports", "App crash logs and system diagnostic data",
                scan_named_paths(vec![("Diagnostic Reports".to_string(), path)], Duration::from_secs(10))));
        })
    };

    let _h_saved = {
        let tx = tx.clone();
        let path = lib.join("Saved Application State");
        thread::spawn(move || {
            let _ = tx.send(make_category("saved_states", "Saved App States", "Window restore data saved by macOS for every app",
                scan_named_paths(vec![("Saved States".to_string(), path)], Duration::from_secs(10))));
        })
    };

    let _h_lang = {
        let tx = tx.clone();
        let home = home.clone();
        thread::spawn(move || { let _ = tx.send(scan_language_files(home)); })
    };

    let _h_large = {
        let tx = tx.clone();
        let home = home.clone();
        thread::spawn(move || { let _ = tx.send(scan_large_files(home)); })
    };

    let _h_old_dl = {
        let tx = tx.clone();
        let home = home.clone();
        thread::spawn(move || { let _ = tx.send(scan_old_downloads(home)); })
    };

    let _h_snapshots = {
        let tx = tx.clone();
        thread::spawn(move || { let _ = tx.send(scan_snapshots()); })
    };

    // Drop original sender so channel closes when all threads finish
    drop(tx);

    // ── Drain results and emit events as they arrive ──────────────────────────
    let mut categories: Vec<JunkCategory> = Vec::new();
    for cat in rx {
        // Always emit progress tick so Dashboard counter reaches 12/12
        let _ = app.emit("junk_progress", ());
        if cat.size > 0 {
            let _ = app.emit("junk_category", &cat);
            categories.push(cat);
        }
    }

    categories.sort_by(|a, b| b.size.cmp(&a.size));
    let total_size: u64 = categories.iter().map(|c| c.size).sum();

    // Update cache
    *JUNK_CACHE.lock().unwrap_or_else(|e| e.into_inner()) = Some((JunkReport {
        categories: categories.clone(),
        total_size,
        total_size_human: humanize_bytes(total_size),
    }, std::time::Instant::now()));

    let _ = app.emit("junk_scan_done", JunkScanDone {
        total_size,
        total_size_human: humanize_bytes(total_size),
    });

    Ok(())
}

/// Delete APFS local snapshots by their tmutil identifiers.
/// Tries without privileges first; batches all remaining into ONE admin prompt.
#[tauri::command]
pub async fn delete_apfs_snapshots(names: Vec<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut deleted = 0u64;
        let mut needs_admin: Vec<String> = Vec::new();

        // Step 1: try each snapshot without admin
        for name in &names {
            let ok = Command::new("tmutil")
                .args(["deletelocalsnapshot", name])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .map(|s| s.success())
                .unwrap_or(false);

            if ok { deleted += 1; } else { needs_admin.push(name.clone()); }
        }

        // Step 2: one admin prompt for all that need it (avoids N password dialogs)
        if !needs_admin.is_empty() {
            let cmds: String = needs_admin
                .iter()
                .map(|n| format!("tmutil deletelocalsnapshot '{}'", n.replace('\'', "'\\''")))
                .collect::<Vec<_>>()
                .join("; ");
            let shell = format!("{}; true", cmds);
            let osa_inner = shell.replace('"', "\\\"");
            let script = format!(
                "do shell script \"{}\" with administrator privileges",
                osa_inner
            );
            let admin_ok = Command::new("osascript")
                .args(["-e", &script])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .map(|s| s.success())
                .unwrap_or(false);

            if admin_ok {
                // Count what actually disappeared
                for name in &needs_admin {
                    // tmutil doesn't leave a filesystem path to check, so trust admin success
                    let _ = name;
                    deleted += 1;
                }
            }
            // If user cancelled the prompt: silently keep only what was removed without admin
        }

        clear_junk_cache();
        Ok(format!("{} snapshots deleted", deleted))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── humanize_bytes ─────────────────────────────────────────────────────

    #[test]
    fn humanize_bytes_zero() {
        assert_eq!(humanize_bytes(0), "0 B");
    }

    #[test]
    fn humanize_bytes_exact_bytes() {
        assert_eq!(humanize_bytes(1), "1 B");
        assert_eq!(humanize_bytes(1023), "1023 B");
    }

    #[test]
    fn humanize_bytes_kilobytes() {
        assert_eq!(humanize_bytes(1024), "1.0 KB");
        assert_eq!(humanize_bytes(1536), "1.5 KB");
    }

    #[test]
    fn humanize_bytes_megabytes() {
        assert_eq!(humanize_bytes(1024 * 1024), "1.0 MB");
        assert_eq!(humanize_bytes(1024 * 1024 * 100), "100.0 MB");
    }

    #[test]
    fn humanize_bytes_gigabytes() {
        assert_eq!(humanize_bytes(1024u64.pow(3)), "1.0 GB");
    }

    #[test]
    fn humanize_bytes_terabytes() {
        assert_eq!(humanize_bytes(1024u64.pow(4)), "1.0 TB");
    }

    // ── should_keep_lproj ──────────────────────────────────────────────────

    fn keep(langs: &[&str]) -> Vec<String> {
        langs.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn keep_lproj_exact_match() {
        assert!(should_keep_lproj("en", &keep(&["en"])));
        assert!(should_keep_lproj("fr", &keep(&["en", "fr"])));
    }

    #[test]
    fn keep_lproj_region_variant_kept() {
        assert!(should_keep_lproj("en-US", &keep(&["en"])));
        assert!(should_keep_lproj("zh-Hans", &keep(&["zh"])));
    }

    #[test]
    fn keep_lproj_base_kept_when_region_in_list() {
        assert!(should_keep_lproj("en", &keep(&["en-US"])));
    }

    #[test]
    fn keep_lproj_case_insensitive() {
        assert!(should_keep_lproj("EN", &keep(&["en"])));
        assert!(should_keep_lproj("en", &keep(&["EN"])));
    }

    #[test]
    fn keep_lproj_rejects_unrelated_language() {
        assert!(!should_keep_lproj("fr", &keep(&["en"])));
        assert!(!should_keep_lproj("de", &keep(&["en", "tr"])));
    }

    #[test]
    fn keep_lproj_empty_keep_list_rejects_all() {
        assert!(!should_keep_lproj("en", &[]));
        assert!(!should_keep_lproj("fr", &[]));
    }

    // ── in_skip_dir ────────────────────────────────────────────────────────

    #[test]
    fn skip_dir_matches_full_segment() {
        assert!(in_skip_dir("/Users/x/dev/node_modules/foo.bin"));
        assert!(in_skip_dir("/Users/x/proj/.git/objects/pack"));
        assert!(in_skip_dir("/Users/x/rust/target/release/app"));
    }

    #[test]
    fn skip_dir_ignores_non_skipped_paths() {
        assert!(!in_skip_dir("/Users/x/Movies/holiday.mov"));
        assert!(!in_skip_dir("/Users/x/Downloads/installer.dmg"));
    }

    #[test]
    fn skip_dir_does_not_match_substring() {
        // "target" as a substring of a real filename must not trigger a skip
        assert!(!in_skip_dir("/Users/x/Documents/target_audience.key"));
        assert!(!in_skip_dir("/Users/x/my_node_modules_notes.txt"));
    }
}
