use std::fs;
use std::path::{Path, PathBuf};
use std::env;
use std::process::{Command, Stdio};
use std::time::{Duration, UNIX_EPOCH};
use serde::{Serialize, Deserialize};
use rayon::prelude::*;

// ── Structs ───────────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AppInfo {
    pub name: String,
    pub path: String,
    pub bundle_id: String,
    pub size: String,
    pub size_bytes: u64,
    pub last_used: String,
    /// Unix timestamp of last use (0 = unknown) — enables accurate sorting on the frontend
    pub last_used_ts: u64,
    pub icon_path: String,
}

#[derive(Serialize)]
pub struct CacheInfo {
    pub scanned_at: u64,
    pub age_secs: u64,
    pub app_count: u32,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn cache_path() -> Option<PathBuf> {
    let home = env::var("HOME").ok()?;
    Some(PathBuf::from(&home).join("Library/Caches/tellak/app_scan_cache"))
}

fn humanize_bytes(bytes: u64) -> String {
    const UNITS: &[&str] = &["B", "KB", "MB", "GB", "TB"];
    if bytes == 0 { return "0 B".to_string(); }
    let mut size = bytes as f64;
    let mut idx = 0;
    while size >= 1024.0 && idx < UNITS.len() - 1 { size /= 1024.0; idx += 1; }
    if idx == 0 { format!("{} B", bytes) } else { format!("{:.1} {}", size, UNITS[idx]) }
}

/// Parses size strings like "1.2G", "450M", "1.2 GB", "450 MB" → bytes.
fn parse_size_to_bytes(s: &str) -> u64 {
    let s = s.trim();
    let boundary = s.find(|c: char| c.is_ascii_alphabetic() || c == ' ').unwrap_or(s.len());
    let num_str = s[..boundary].trim();
    let unit = s[boundary..].trim().to_uppercase();
    let unit = unit.trim_end_matches('B');
    let value: f64 = num_str.parse().unwrap_or(0.0);
    match unit {
        "" => value as u64,
        "K" | "KI" => (value * 1_024.0) as u64,
        "M" | "MI" => (value * 1_048_576.0) as u64,
        "G" | "GI" => (value * 1_073_741_824.0) as u64,
        "T" | "TI" => (value * 1_099_511_627_776.0) as u64,
        _ => 0,
    }
}

/// Parses an mdls date string "YYYY-MM-DD HH:MM:SS +0000" to a Unix timestamp.
/// Used for sorting by last-used date. Approximate (ignores leap seconds, assumes UTC).
fn mdls_date_to_timestamp(s: &str) -> u64 {
    let parts: Vec<&str> = s.split_whitespace().collect();
    if parts.is_empty() { return 0; }
    let date_parts: Vec<u64> = parts[0].splitn(3, '-').filter_map(|p| p.parse().ok()).collect();
    let time_parts: Vec<u64> = parts.get(1).unwrap_or(&"").splitn(3, ':').filter_map(|p| p.parse().ok()).collect();
    if date_parts.len() < 3 { return 0; }
    let (year, month, day) = (date_parts[0], date_parts[1], date_parts[2]);
    let (hour, min, sec) = (
        time_parts.first().copied().unwrap_or(0),
        time_parts.get(1).copied().unwrap_or(0),
        time_parts.get(2).copied().unwrap_or(0),
    );
    let is_leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
    let month_days: &[u64] = if is_leap {
        &[0, 31, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335]
    } else {
        &[0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]
    };
    let leap_years = (1970..year).filter(|&y| (y % 4 == 0 && y % 100 != 0) || y % 400 == 0).count() as u64;
    let days = (year - 1970) * 365 + leap_years
        + month_days.get(month as usize - 1).copied().unwrap_or(0)
        + day - 1;
    days * 86400 + hour * 3600 + min * 60 + sec
}

/// Returns the PNG icon path for an app, converting from .icns via sips if needed.
fn get_icon_png_path(app_path: &str, bundle_id: &str, app_name: &str) -> String {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/Users/unknown".to_string());
    let cache_dir = PathBuf::from(&home).join("Library/Caches/tellak/icons");
    let key = if !bundle_id.is_empty() { bundle_id } else { app_name };
    let safe_key: String = key.chars().map(|c| if c.is_alphanumeric() || c == '.' { c } else { '_' }).collect();
    let png_path = cache_dir.join(format!("{}.png", safe_key));

    if png_path.exists() { return png_path.to_string_lossy().to_string(); }

    let resources = format!("{}/Contents/Resources", app_path);
    let candidates = [
        format!("{}/AppIcon.icns", resources),
        format!("{}/{}.icns", resources, app_name),
        format!("{}/app.icns", resources),
        format!("{}/Icon.icns", resources),
        format!("{}/Application.icns", resources),
    ];
    let icns_path = candidates.iter().find(|c| Path::new(c.as_str()).exists()).cloned()
        .unwrap_or_else(|| {
            std::fs::read_dir(&resources).ok()
                .and_then(|mut rd| rd.find(|e| {
                    e.as_ref().ok().map(|e| e.path().extension().map(|x| x == "icns").unwrap_or(false)).unwrap_or(false)
                }))
                .and_then(|e| e.ok())
                .map(|e| e.path().to_string_lossy().to_string())
                .unwrap_or_default()
        });

    if icns_path.is_empty() { return String::new(); }

    let _ = std::fs::create_dir_all(&cache_dir);
    let ok = Command::new("sips")
        .args(["-s", "format", "png", &icns_path, "--out", &png_path.to_string_lossy()])
        .stdout(Stdio::null()).stderr(Stdio::null())
        .status().map(|s| s.success()).unwrap_or(false);

    if ok && png_path.exists() { png_path.to_string_lossy().to_string() } else { String::new() }
}

/// Removes all cache lines that reference `app_path` so the next load is accurate.
fn remove_from_cache(app_path: &str) {
    let Some(path) = cache_path() else { return };
    let Ok(content) = fs::read_to_string(&path) else { return };
    let filtered = content.lines().filter(|l| !l.contains(app_path)).collect::<Vec<_>>().join("\n");
    if filtered.len() != content.len() { let _ = fs::write(&path, filtered); }
}

// ── Native app scanner ────────────────────────────────────────────────────────

/// Collects size, bundle ID, and last-used date for a single .app bundle.
fn scan_one_app(app_path: &str) -> Option<AppInfo> {
    if !Path::new(app_path).exists() { return None; }

    let name = Path::new(app_path).file_stem()?.to_string_lossy().to_string();

    // Size via du -sk
    let du_out = Command::new("du").args(["-sk", app_path])
        .output().ok().and_then(|o| String::from_utf8(o.stdout).ok()).unwrap_or_default();
    let size_kb: u64 = du_out.split_whitespace().next().and_then(|s| s.parse().ok()).unwrap_or(0);
    let size_bytes = size_kb * 1024;

    // Bundle ID via mdls
    let bundle_id = Command::new("mdls")
        .args(["-name", "kMDItemCFBundleIdentifier", "-raw", app_path])
        .output().ok().and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| s != "(null)" && !s.is_empty())
        .unwrap_or_default();

    // Last-used date via mdls
    let last_used_raw = Command::new("mdls")
        .args(["-name", "kMDItemLastUsedDate", "-raw", app_path])
        .output().ok().and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| s != "(null)" && !s.is_empty())
        .unwrap_or_default();

    let last_used_ts = mdls_date_to_timestamp(&last_used_raw);
    let last_used = if last_used_raw.is_empty() { "Unknown".to_string() } else { last_used_raw };

    let icon_path = get_icon_png_path(app_path, &bundle_id, &name);

    Some(AppInfo {
        name,
        path: app_path.to_string(),
        bundle_id,
        size: humanize_bytes(size_bytes),
        size_bytes,
        last_used,
        last_used_ts,
        icon_path,
    })
}

/// Discovers all .app bundles in /Applications and ~/Applications, scans them
/// in parallel with Rayon, writes the results to a 24-hour cache, and returns
/// the list sorted by size descending.
fn scan_apps_native(force: bool) -> Result<Vec<AppInfo>, String> {
    let home = env::var("HOME").unwrap_or_else(|_| "/Users/unknown".to_string());
    let cache = cache_path().ok_or("HOME not set")?;

    // Return cached data if fresh enough
    if !force && cache.exists() {
        if let Ok(meta) = fs::metadata(&cache) {
            if let Ok(modified) = meta.modified() {
                if let Ok(elapsed) = modified.elapsed() {
                    if elapsed < Duration::from_secs(86400) {
                        return parse_app_cache(&cache);
                    }
                }
            }
        }
    }

    // Discover .app bundles (depth 1 only — same as before)
    let search_dirs = ["/Applications".to_string(), format!("{}/Applications", home)];
    let mut app_paths: Vec<String> = Vec::new();
    for dir in &search_dirs {
        let p = Path::new(dir);
        if !p.exists() { continue; }
        if let Ok(rd) = fs::read_dir(p) {
            for entry in rd.filter_map(|e| e.ok()) {
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()) == Some("app") {
                    app_paths.push(path.to_string_lossy().to_string());
                }
            }
        }
    }

    // Scan all apps in parallel
    let mut apps: Vec<AppInfo> = app_paths.par_iter()
        .filter_map(|p| scan_one_app(p))
        .collect();

    apps.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));

    // Write cache
    if let Some(parent) = cache.parent() { let _ = fs::create_dir_all(parent); }
    let content = apps.iter()
        .map(|a| format!("{}|{}|{}|{}|{}|{}", a.last_used_ts, a.path, a.name, a.bundle_id, a.size, a.last_used))
        .collect::<Vec<_>>()
        .join("\n");
    let _ = fs::write(&cache, content);

    Ok(apps)
}

fn parse_app_cache(cache: &PathBuf) -> Result<Vec<AppInfo>, String> {
    let content = fs::read_to_string(cache).map_err(|e| format!("Failed to read app cache: {}", e))?;

    let mut apps: Vec<AppInfo> = content.lines().filter_map(|line| {
        let parts: Vec<&str> = line.split('|').collect();
        if parts.len() < 6 { return None; }
        let size = parts[4].to_string();
        let size_bytes = parse_size_to_bytes(&size);
        let last_used_ts: u64 = parts[0].trim().parse().unwrap_or(0);
        Some(AppInfo {
            name: parts[2].to_string(),
            path: parts[1].to_string(),
            bundle_id: parts[3].to_string(),
            size,
            size_bytes,
            last_used: parts[5].to_string(),
            last_used_ts,
            icon_path: String::new(),
        })
    }).collect();

    apps.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));

    // Fill icons in parallel
    let apps: Vec<AppInfo> = apps.into_par_iter().map(|app| {
        let icon_path = get_icon_png_path(&app.path, &app.bundle_id, &app.name);
        AppInfo { icon_path, ..app }
    }).collect();

    Ok(apps)
}

// ── Commands ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_installed_apps(force: bool) -> Result<Vec<AppInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || scan_apps_native(force))
        .await
        .map_err(|e| e.to_string())?
}

/// Returns metadata about the app cache without re-scanning.
#[tauri::command]
pub async fn get_cache_info() -> Option<CacheInfo> {
    let path = cache_path()?;
    if !path.exists() { return None; }
    let metadata = fs::metadata(&path).ok()?;
    let modified = metadata.modified().ok()?;
    let scanned_at = modified.duration_since(UNIX_EPOCH).ok()?.as_secs();
    let age_secs = modified.elapsed().ok()?.as_secs();
    let content = fs::read_to_string(&path).ok()?;
    let app_count = content.lines().filter(|l| l.contains('|')).count() as u32;
    Some(CacheInfo { scanned_at, age_secs, app_count })
}

#[tauri::command]
pub async fn uninstall_app(app_path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if !app_path.ends_with(".app") {
            return Err("Invalid app path — must end with .app".to_string());
        }
        let path = PathBuf::from(&app_path);
        if !path.exists() { return Err(format!("App not found: {}", app_path)); }

        let app_name = path.file_name().and_then(|n| n.to_str()).ok_or("Could not determine app name")?;
        let home = env::var("HOME").unwrap_or_else(|_| "/Users/unknown".to_string());
        let trash_dir = PathBuf::from(&home).join(".Trash");

        // Try direct rename to ~/.Trash (no prompt for user-owned apps)
        let trash_dest = {
            let base = trash_dir.join(app_name);
            if !base.exists() { base } else {
                let ts = std::time::SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
                trash_dir.join(format!("{}_{}", app_name, ts))
            }
        };

        if std::fs::rename(&path, &trash_dest).is_ok() {
            remove_from_cache(&app_path);
            return Ok(format!("{} Çöp Kutusu'na taşındı", app_name));
        }

        // Fallback: osascript with admin (system apps in /Applications)
        let quoted_src = format!("'{}'", app_path.replace('\'', "'\\''"));
        let quoted_dst = format!("'{}'", trash_dest.to_string_lossy().replace('\'', "'\\''"));
        let shell_cmd  = format!("mv {} {}", quoted_src, quoted_dst);
        let osa_script = format!("do shell script \"{}\" with administrator privileges",
            shell_cmd.replace('\\', "\\\\").replace('"', "\\\""));

        let status = Command::new("osascript")
            .args(["-e", &osa_script])
            .stdin(Stdio::null())
            .status()
            .map_err(|e| format!("osascript çalıştırılamadı: {}", e))?;

        if status.success() {
            remove_from_cache(&app_path);
            Ok(format!("{} Çöp Kutusu'na taşındı", app_name))
        } else {
            Err(format!("{} Çöp Kutusu'na taşınamadı — yönetici izni iptal edildi ya da reddedildi.", app_name))
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn humanize_bytes_boundaries() {
        assert_eq!(humanize_bytes(0), "0 B");
        assert_eq!(humanize_bytes(1024), "1.0 KB");
        assert_eq!(humanize_bytes(1_073_741_824), "1.0 GB");
    }

    #[test]
    fn parse_size_handles_compact_units() {
        assert_eq!(parse_size_to_bytes("1024"), 1024);
        assert_eq!(parse_size_to_bytes("1.5K"), 1536);
        assert_eq!(parse_size_to_bytes("450M"), 450 * 1_048_576);
        assert_eq!(parse_size_to_bytes("2G"), 2 * 1_073_741_824);
    }

    #[test]
    fn parse_size_handles_spaced_and_b_suffix() {
        assert_eq!(parse_size_to_bytes("1.2 GB"), parse_size_to_bytes("1.2G"));
        assert_eq!(parse_size_to_bytes("450 MB"), 450 * 1_048_576);
        assert_eq!(parse_size_to_bytes("2 KiB"), 2048);
    }

    #[test]
    fn parse_size_rejects_garbage() {
        assert_eq!(parse_size_to_bytes(""), 0);
        assert_eq!(parse_size_to_bytes("garbage"), 0);
        assert_eq!(parse_size_to_bytes("xyz"), 0);
    }

    #[test]
    fn mdls_date_epoch_and_known_dates() {
        assert_eq!(mdls_date_to_timestamp("1970-01-01 00:00:00 +0000"), 0);
        assert_eq!(mdls_date_to_timestamp("1970-01-02 00:00:00 +0000"), 86_400);
        // 2000-01-01 00:00:00 UTC == 946684800
        assert_eq!(mdls_date_to_timestamp("2000-01-01 00:00:00 +0000"), 946_684_800);
    }

    #[test]
    fn mdls_date_ordering_and_malformed() {
        let earlier = mdls_date_to_timestamp("2021-06-15 12:30:45 +0000");
        let later = mdls_date_to_timestamp("2023-06-15 12:30:45 +0000");
        assert!(later > earlier);
        assert_eq!(mdls_date_to_timestamp(""), 0);
        assert_eq!(mdls_date_to_timestamp("not-a-date"), 0);
    }
}
