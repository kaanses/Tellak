use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

// ── Types ─────────────────────────────────────────────────────────────────────

#[derive(Serialize, Clone)]
pub struct PrivacyItem {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub size_human: String,
}

#[derive(Serialize, Clone)]
pub struct PrivacyCategory {
    pub id: String,
    pub name: String,
    pub description: String,
    pub size: u64,
    pub size_human: String,
    pub items: Vec<PrivacyItem>,
}

#[derive(Serialize)]
pub struct PrivacyReport {
    pub categories: Vec<PrivacyCategory>,
    pub total_size: u64,
    pub total_size_human: String,
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

fn home() -> PathBuf {
    std::env::var("HOME").map(PathBuf::from).unwrap_or_else(|_| PathBuf::from("/Users/unknown"))
}

fn file_size(path: &Path) -> u64 {
    std::fs::metadata(path).map(|m| m.len()).unwrap_or(0)
}

fn make_item(name: &str, path: PathBuf) -> Option<PrivacyItem> {
    if !path.exists() { return None; }
    let size = file_size(&path);
    Some(PrivacyItem {
        name: name.to_string(),
        path: path.to_string_lossy().to_string(),
        size,
        size_human: humanize_bytes(size),
    })
}

fn make_category(id: &str, name: &str, desc: &str, items: Vec<PrivacyItem>) -> PrivacyCategory {
    let size: u64 = items.iter().map(|i| i.size).sum();
    PrivacyCategory {
        id: id.to_string(),
        name: name.to_string(),
        description: desc.to_string(),
        size,
        size_human: humanize_bytes(size),
        items,
    }
}

/// Find files named `filename` inside any direct child of `profiles_dir`
fn find_profile_files(profiles_dir: &Path, filename: &str) -> Vec<PathBuf> {
    let Ok(rd) = std::fs::read_dir(profiles_dir) else { return vec![]; };
    rd.filter_map(|e| e.ok())
        .map(|e| e.path().join(filename))
        .filter(|p| p.exists())
        .collect()
}

// ── Scanners ──────────────────────────────────────────────────────────────────

fn scan_browser_history(home: &Path) -> PrivacyCategory {
    let lib = home.join("Library");
    let app = lib.join("Application Support");
    let mut items: Vec<PrivacyItem> = Vec::new();

    for (name, path) in &[
        ("Safari",  lib.join("Safari/History.db")),
        ("Chrome",  app.join("Google/Chrome/Default/History")),
        ("Edge",    app.join("Microsoft Edge/Default/History")),
        ("Arc",     app.join("Arc/User Data/Default/History")),
        ("Brave",   app.join("BraveSoftware/Brave-Browser/Default/History")),
        ("Opera",   app.join("com.operasoftware.Opera/History")),
        ("Vivaldi", app.join("Vivaldi/Default/History")),
    ] {
        if let Some(item) = make_item(name, path.clone()) { items.push(item); }
    }
    for path in find_profile_files(&app.join("Firefox/Profiles"), "places.sqlite") {
        if let Some(item) = make_item("Firefox", path) { items.push(item); }
    }
    for path in find_profile_files(&app.join("zen/Profiles"), "places.sqlite") {
        if let Some(item) = make_item("Zen", path) { items.push(item); }
    }

    items.sort_by(|a, b| b.size.cmp(&a.size));
    make_category("browser_history", "Browser History", "Browsing history stored by installed browsers — close browsers first", items)
}

fn scan_browser_cookies(home: &Path) -> PrivacyCategory {
    let lib = home.join("Library");
    let app = lib.join("Application Support");
    let mut items: Vec<PrivacyItem> = Vec::new();

    for (name, path) in &[
        ("Safari",  lib.join("Cookies/Cookies.binarycookies")),
        ("Chrome",  app.join("Google/Chrome/Default/Cookies")),
        ("Edge",    app.join("Microsoft Edge/Default/Cookies")),
        ("Arc",     app.join("Arc/User Data/Default/Cookies")),
        ("Brave",   app.join("BraveSoftware/Brave-Browser/Default/Cookies")),
        ("Vivaldi", app.join("Vivaldi/Default/Cookies")),
    ] {
        if let Some(item) = make_item(name, path.clone()) { items.push(item); }
    }
    for path in find_profile_files(&app.join("Firefox/Profiles"), "cookies.sqlite") {
        if let Some(item) = make_item("Firefox", path) { items.push(item); }
    }

    items.sort_by(|a, b| b.size.cmp(&a.size));
    make_category("browser_cookies", "Browser Cookies", "Cookies stored by installed browsers", items)
}

fn scan_recent_files(home: &Path) -> PrivacyCategory {
    let sfl_dir = home.join("Library/Application Support/com.apple.sharedfilelist");
    let Ok(rd) = std::fs::read_dir(&sfl_dir) else {
        return make_category("recent_files", "Recent Files", "macOS recent documents and applications list", vec![]);
    };

    let mut items: Vec<PrivacyItem> = rd.filter_map(|e| e.ok())
        .filter(|e| {
            let ext = e.path().extension().map(|x| x.to_string_lossy().to_string()).unwrap_or_default();
            ext == "sfl3" || ext == "sfl2"
        })
        .filter_map(|e| {
            let path = e.path();
            let stem = path.file_stem()?.to_string_lossy().to_string();
            let readable = stem
                .replace("com.apple.LSSharedFileList.", "")
                .replace("com.apple.", "");
            let size = file_size(&path);
            Some(PrivacyItem { name: readable, path: path.to_string_lossy().to_string(), size, size_human: humanize_bytes(size) })
        })
        .collect();

    items.sort_by(|a, b| b.size.cmp(&a.size));
    make_category("recent_files", "Recent Files", "macOS recent documents, apps, and servers history", items)
}

fn scan_downloads_history(home: &Path) -> PrivacyCategory {
    let path = home.join("Library/Preferences/com.apple.LaunchServices.QuarantineEventsV2");
    let items = make_item("Quarantine Events", path).map(|i| vec![i]).unwrap_or_default();
    make_category("downloads_history", "Downloads History", "Record of every file downloaded from the internet", items)
}

// ── Commands ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_privacy_info() -> Result<PrivacyReport, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let home = home();
        let all = vec![
            scan_browser_history(&home),
            scan_browser_cookies(&home),
            scan_recent_files(&home),
            scan_downloads_history(&home),
            // always-present action items (no files, just commands)
            make_category("dns_cache",  "DNS Cache",  "Cached DNS lookups — flush to improve privacy", vec![]),
            make_category("clipboard",  "Clipboard",  "Text and images currently in your clipboard",   vec![]),
        ];

        let categories: Vec<PrivacyCategory> = all.into_iter()
            .filter(|c| c.size > 0 || matches!(c.id.as_str(), "dns_cache" | "clipboard"))
            .collect();

        let total_size: u64 = categories.iter().map(|c| c.size).sum();
        Ok(PrivacyReport { categories, total_size, total_size_human: humanize_bytes(total_size) })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Flush the system DNS cache. Requires admin.
#[tauri::command]
pub async fn flush_dns_cache() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| {
        let script = r#"do shell script "dscacheutil -flushcache; killall -HUP mDNSResponder" with administrator privileges"#;
        let ok = Command::new("osascript")
            .args(["-e", script])
            .stdout(Stdio::null()).stderr(Stdio::null())
            .status().map(|s| s.success()).unwrap_or(false);
        if ok { Ok(()) } else { Err("DNS flush failed or was cancelled".to_string()) }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Clean all privacy items in a single admin prompt.
/// Batches file deletions + optional DNS flush into one osascript call so the
/// user is only ever asked for their password once.
#[tauri::command]
pub async fn clean_privacy_all(paths: Vec<String>, flush_dns: bool) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut removed = 0u64;
        let mut needs_admin: Vec<String> = Vec::new();

        // Step 1: try removing files without admin (works for user-owned files)
        for path_str in &paths {
            if !std::path::Path::new(path_str).exists() { continue; }
            let ok = Command::new("rm")
                .args(["-rf", path_str])
                .stdout(Stdio::null()).stderr(Stdio::null())
                .status().map(|s| s.success()).unwrap_or(false);
            if ok { removed += 1; } else { needs_admin.push(path_str.clone()); }
        }

        // Step 2: one admin prompt — file removals + DNS flush together
        let has_admin_work = !needs_admin.is_empty() || flush_dns;
        if has_admin_work {
            let mut cmds: Vec<String> = needs_admin
                .iter()
                .map(|p| format!("rm -rf '{}'", p.replace('\'', "'\\''")))
                .collect();
            if flush_dns {
                cmds.push("dscacheutil -flushcache".to_string());
                cmds.push("killall -HUP mDNSResponder".to_string());
            }
            cmds.push("true".to_string()); // ensure exit 0 even on partial failures

            let shell = cmds.join("; ");
            let osa_inner = shell.replace('"', "\\\"");
            let script = format!("do shell script \"{}\" with administrator privileges", osa_inner);

            let admin_ok = Command::new("osascript")
                .args(["-e", &script])
                .stdout(Stdio::null()).stderr(Stdio::null())
                .status().map(|s| s.success()).unwrap_or(false);

            if admin_ok {
                for path_str in &needs_admin {
                    if !std::path::Path::new(path_str).exists() { removed += 1; }
                }
            } else {
                return Err("Admin authorisation cancelled".to_string());
            }
        }

        Ok(format!("{} öğe kaldırıldı", removed))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Clear the system clipboard.
#[tauri::command]
pub async fn clear_clipboard() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| {
        let ok = Command::new("sh")
            .args(["-c", "pbcopy < /dev/null"])
            .status().map(|s| s.success()).unwrap_or(false);
        if ok { Ok(()) } else { Err("Failed to clear clipboard".to_string()) }
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
        assert_eq!(humanize_bytes(2048), "2.0 KB");
        assert_eq!(humanize_bytes(1_572_864), "1.5 MB");
    }

    #[test]
    fn file_size_of_missing_path_is_zero() {
        assert_eq!(file_size(std::path::Path::new("/nonexistent/path/xyz123")), 0);
    }
}
