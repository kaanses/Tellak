use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

// ── Types ─────────────────────────────────────────────────────────────────────

#[derive(Serialize, Clone)]
pub struct TrashItem {
    pub name: String,
    pub path: String,       // POSIX path — used for deletion
    pub size: u64,
    pub size_human: String,
    pub is_icloud: bool,    // true when Finder reports size = 0 (evicted to iCloud)
}

#[derive(Serialize)]
pub struct TrashInfo {
    pub items: Vec<TrashItem>,
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

fn run_osascript(script: &str) -> Result<String, String> {
    let out = Command::new("osascript")
        .args(["-e", script])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

// ── Commands ──────────────────────────────────────────────────────────────────

/// Returns a PNG thumbnail path for a trash item, generating + caching it on
/// first call. Returns an empty string if thumbnail can't be produced.
/// Strategy:
///   .app bundles   → extract .icns from Contents/Resources, convert via sips
///   images         → sips resize to 128px PNG
///   everything else → qlmanage Quick Look thumbnail (same as Finder)
#[tauri::command]
pub async fn get_trash_item_icon(path: String) -> String {
    tauri::async_runtime::spawn_blocking(move || {
        let p = Path::new(&path);

        // ── Cache key ─────────────────────────────────────────────────────────
        let home = std::env::var("HOME").unwrap_or_else(|_| "/Users/unknown".to_string());
        let cache_dir = PathBuf::from(&home).join("Library/Caches/tellak/trash_icons");
        let _ = std::fs::create_dir_all(&cache_dir);

        // Use the file name with a disambiguating hash of the full path
        let hash: u64 = path.bytes().enumerate()
            .fold(0u64, |acc, (i, b)| acc.wrapping_add((b as u64).wrapping_mul(i as u64 + 31)));
        let stem = p.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "file".into());
        let cache_key = format!("{}_{:x}.png", stem, hash);
        let out_png = cache_dir.join(&cache_key);

        if out_png.exists() {
            return out_png.to_string_lossy().to_string();
        }

        let ext = p.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();

        // ── .app bundle → .icns via sips ─────────────────────────────────────
        if ext == "app" {
            let resources = p.join("Contents/Resources");
            let icns = find_first_icns(&resources);
            if let Some(icns_path) = icns {
                let ok = Command::new("sips")
                    .args(["-s", "format", "png", &icns_path.to_string_lossy(), "--out", &out_png.to_string_lossy()])
                    .stdout(Stdio::null()).stderr(Stdio::null())
                    .status().map(|s| s.success()).unwrap_or(false);
                if ok && out_png.exists() { return out_png.to_string_lossy().to_string(); }
            }
            return String::new();
        }

        // ── Images → sips resize ──────────────────────────────────────────────
        const IMG_EXTS: &[&str] = &["jpg","jpeg","png","gif","webp","heic","tiff","bmp","raw","cr2","nef"];
        if IMG_EXTS.contains(&ext.as_str()) {
            let ok = Command::new("sips")
                .args(["-s", "format", "png", "--resampleWidth", "128", &path, "--out", &out_png.to_string_lossy()])
                .stdout(Stdio::null()).stderr(Stdio::null())
                .status().map(|s| s.success()).unwrap_or(false);
            if ok && out_png.exists() { return out_png.to_string_lossy().to_string(); }
            return String::new();
        }

        // ── Everything else → qlmanage Quick Look thumbnail ───────────────────
        // qlmanage writes <filename>.png into the output dir
        let tmp_dir = cache_dir.join(format!("ql_{:x}", hash));
        let _ = std::fs::create_dir_all(&tmp_dir);

        let ok = Command::new("qlmanage")
            .args(["-t", "-s", "128", "-o", &tmp_dir.to_string_lossy(), &path])
            .stdout(Stdio::null()).stderr(Stdio::null())
            .status().map(|s| s.success()).unwrap_or(false);

        if ok {
            // qlmanage names the output "<original_filename>.png"
            let fname = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            let ql_out = tmp_dir.join(format!("{}.png", fname));
            if ql_out.exists()
                && std::fs::rename(&ql_out, &out_png).is_ok() {
                    let _ = std::fs::remove_dir(&tmp_dir);
                    return out_png.to_string_lossy().to_string();
                }
        }
        let _ = std::fs::remove_dir_all(&tmp_dir);
        String::new()
    })
    .await
    .unwrap_or_default()
}

fn find_first_icns(resources: &Path) -> Option<PathBuf> {
    let priority = ["AppIcon.icns", "app.icns", "Icon.icns", "Application.icns"];
    for name in &priority {
        let c = resources.join(name);
        if c.exists() { return Some(c); }
    }
    std::fs::read_dir(resources).ok()?.flatten()
        .find(|e| e.path().extension().map(|x| x == "icns").unwrap_or(false))
        .map(|e| e.path())
}

/// Returns every item in Finder's Trash with name, POSIX path, and size.
/// Direct filesystem access to ~/.Trash is blocked by macOS TCC, so we go
/// through Finder which already has the entitlement.
#[tauri::command]
pub async fn get_trash_info() -> Result<TrashInfo, String> {
    tauri::async_runtime::spawn_blocking(|| {
        // Each line: name|size_bytes|posix_path
        let script = r#"tell application "Finder"
    set output to ""
    set trashItems to items of trash
    repeat with i from 1 to count of trashItems
        set theItem to item i of trashItems
        set itemName to name of theItem
        set itemPath to POSIX path of (theItem as alias)
        try
            set itemSize to size of theItem
        on error
            set itemSize to 0
        end try
        set output to output & itemName & "|" & (itemSize as string) & "|" & itemPath
        if i < count of trashItems then set output to output & (ASCII character 10)
    end repeat
    return output
end tell"#;

        let raw = run_osascript(script)?;
        let mut items: Vec<TrashItem> = Vec::new();
        let mut total_size: u64 = 0;

        for line in raw.lines() {
            let line = line.trim();
            if line.is_empty() { continue; }
            let mut parts = line.splitn(3, '|');
            let name = parts.next().unwrap_or("").to_string();
            let size: u64 = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
            let path = parts.next().unwrap_or("").trim_end_matches('/').to_string();
            if name.is_empty() { continue; }
            total_size += size;
            items.push(TrashItem {
                is_icloud: size == 0,
                size_human: if size == 0 { "iCloud".to_string() } else { humanize_bytes(size) },
                name, path, size,
            });
        }

        // Sort: largest first, iCloud items at the end
        items.sort_by(|a, b| b.size.cmp(&a.size));

        Ok(TrashInfo {
            total_size_human: humanize_bytes(total_size),
            items,
            total_size,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Restores a single Trash item.
/// Tries JXA `putBack()` first (knows original location). On macOS Sequoia,
/// `putBack()` is broken (-1728), so we fall back to `mv` to Desktop.
/// Returns a human-readable message about where the file was restored.
#[tauri::command]
pub async fn restore_trash_item(path: String, name: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        // ── Try JXA putBack() ────────────────────────────────────────────────
        let escaped_name = name
            .replace('\\', "\\\\")
            .replace('"', "\\\"")
            .replace('\n', "\\n")
            .replace('\r', "\\r");
        let script = format!(
            r#"var finder = Application('Finder');
var all = finder.trash.items();
var target = null;
for (var i = 0; i < all.length; i++) {{
    if (all[i].name() === "{name}") {{ target = all[i]; break; }}
}}
if (target === null) {{ throw new Error('not found'); }}
target.putBack();"#,
            name = escaped_name
        );
        let jxa_ok = Command::new("osascript")
            .args(["-l", "JavaScript", "-e", &script])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false);

        if jxa_ok {
            // Machine-readable codes; the frontend localizes the toast.
            return Ok("original".to_string());
        }

        // ── Fallback: mv to Desktop ──────────────────────────────────────────
        // putBack() is broken on macOS Sequoia; direct mv works since the app
        // has filesystem entitlements (same as delete_trash_item uses rm -rf).
        let home = std::env::var("HOME").unwrap_or_else(|_| "/Users/unknown".to_string());
        let dest = PathBuf::from(&home).join("Desktop").join(&name);
        let mv_ok = Command::new("mv")
            .args([&path, &dest.to_string_lossy().to_string()])
            .status()
            .map(|s| s.success())
            .unwrap_or(false);

        if mv_ok {
            Ok("desktop".to_string())
        } else {
            Err("Could not restore file — try opening Finder and using Put Back manually".to_string())
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Permanently deletes a single item from Trash by its POSIX path.
#[tauri::command]
pub async fn delete_trash_item(path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        // Try direct rm first — fast and works when the file is locally present.
        // For iCloud-evicted stubs, this may fail; fall back to Finder delete.
        let rm_ok = Command::new("rm")
            .args(["-rf", &path])
            .status()
            .map(|s| s.success())
            .unwrap_or(false);

        if rm_ok { return Ok(()); }

        // Fallback: ask Finder to delete it (handles locked/iCloud items)
        let escaped = path.replace('\\', "\\\\").replace('"', "\\\"");
        let script = format!(
            r#"tell application "Finder" to delete POSIX file "{}""#,
            escaped
        );
        run_osascript(&script).map(|_| ())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Empties the entire Trash via Finder.
/// We show our own confirmation UI so we just call empty directly.
/// Note: `warns before emptying` property was removed in macOS Sequoia (-10006).
#[tauri::command]
pub async fn empty_trash() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| {
        let result = run_osascript(r#"tell application "Finder" to empty the trash"#)
            .map(|_| ());
        if result.is_ok() {
            super::analyze::clear_junk_cache();
        }
        result
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
        assert_eq!(humanize_bytes(999), "999 B");
        assert_eq!(humanize_bytes(1024), "1.0 KB");
        assert_eq!(humanize_bytes(5 * 1_048_576), "5.0 MB");
    }
}
