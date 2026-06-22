use std::process::{Command, Stdio};

/// Returns true if a path is safe to pass to `rm -rf`.
/// Blocks deletion of system-critical directories.
fn is_safe_to_delete(path_str: &str) -> bool {
    let p = std::path::Path::new(path_str);
    if !p.is_absolute() { return false; }
    if path_str == "/" { return false; }
    const BLOCKED: &[&str] = &[
        "/System", "/private/etc", "/usr/bin", "/usr/sbin",
        "/bin", "/sbin", "/dev", "/private/var/db",
    ];
    !BLOCKED.iter().any(|b| path_str == *b || path_str.starts_with(&format!("{}/", b)))
}

/// Remove unused .lproj directories selected by the user.
///
/// For apps in ~/Applications the user already has write access.
/// For apps in /Applications (owned by root), we fall back to
/// `osascript … with administrator privileges` which prompts for the
/// macOS system password — the standard privileged-helper pattern on macOS.
#[tauri::command]
pub async fn clean_language_files(paths: Vec<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut removed: u64 = 0;
        let mut needs_admin: Vec<String> = Vec::new();

        for path_str in &paths {
            if !path_str.ends_with(".lproj") { continue; }
            if !is_safe_to_delete(path_str) { continue; }
            if !std::path::Path::new(path_str).is_dir() { continue; }

            let ok = Command::new("rm")
                .args(["-rf", path_str])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .map(|s| s.success())
                .unwrap_or(false);

            if ok { removed += 1; } else { needs_admin.push(path_str.clone()); }
        }

        if !needs_admin.is_empty() {
            let cmds: String = needs_admin
                .iter()
                .map(|p| format!("rm -rf '{}'", p.replace('\'', "'\\''")))
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
                for p in &needs_admin {
                    if !std::path::Path::new(p).exists() { removed += 1; }
                }
            }
        }

        super::analyze::clear_junk_cache();
        Ok(format!("{} dil paketi kaldırıldı", removed))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Delete arbitrary paths (files or directories) collected by the analyzer.
///
/// Strategy:
///   1. Try `rm -rf` per path without admin — works for most user-owned files.
///   2. Anything that fails goes into one admin prompt (semicolon-separated so
///      individual failures don't abort the rest). Appends `; true` so osascript
///      always exits 0 once the password is accepted, regardless of per-file errors.
///   3. After the admin script, we re-check which paths still exist to get an
///      accurate removed count — never under-reports partial success.
#[tauri::command]
pub async fn clean_junk_paths(paths: Vec<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut removed = 0u64;
        let mut needs_admin: Vec<String> = Vec::new();

        // Step 1: try without admin
        for path_str in &paths {
            if !is_safe_to_delete(path_str) { continue; }
            if !std::path::Path::new(path_str).exists() {
                continue;
            }
            let ok = Command::new("rm")
                .args(["-rf", path_str])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .map(|s| s.success())
                .unwrap_or(false);

            if ok { removed += 1; } else { needs_admin.push(path_str.clone()); }
        }

        // Step 2: one admin prompt for everything that needs it
        if !needs_admin.is_empty() {
            let cmds: String = needs_admin
                .iter()
                .map(|p| format!("rm -rf '{}'", p.replace('\'', "'\\''")))
                .collect::<Vec<_>>()
                .join("; ");
            // "; true" ensures the script exits 0 once password is accepted,
            // even if some individual rm calls fail (e.g. file still open).
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
                // Count what was actually gone after the admin run
                for path_str in &needs_admin {
                    if !std::path::Path::new(path_str).exists() {
                        removed += 1;
                    }
                }
            }
            // If user cancelled the prompt: silently count only what was removed without admin
        }

        super::analyze::clear_junk_cache();
        Ok(format!("{} öğe kaldırıldı", removed))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Triggers a single admin password prompt with no side effects.
/// macOS caches the credential for ~5 minutes, so subsequent
/// `do shell script ... with administrator privileges` calls in the
/// same session won't show another dialog.
#[tauri::command]
pub async fn request_admin_auth() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| {
        let ok = std::process::Command::new("osascript")
            .args(["-e", "do shell script \"true\" with administrator privileges"])
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        if ok { Ok(()) } else { Err("cancelled".to_string()) }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Opens macOS System Settings at the Privacy & Security → Full Disk Access panel.
#[tauri::command]
pub async fn open_system_settings() -> Result<(), String> {
    std::process::Command::new("open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles")
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Reveals a file or folder in Finder (equivalent to "Show in Finder").
#[tauri::command]
pub async fn reveal_in_finder(path: String) -> Result<(), String> {
    std::process::Command::new("open")
        .args(["-R", &path])
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── is_safe_to_delete ──────────────────────────────────────────────────

    #[test]
    fn safe_to_delete_rejects_non_absolute() {
        assert!(!is_safe_to_delete("relative/path"));
        assert!(!is_safe_to_delete("../escape"));
        assert!(!is_safe_to_delete(""));
    }

    #[test]
    fn safe_to_delete_rejects_blocked_exact() {
        assert!(!is_safe_to_delete("/System"));
        assert!(!is_safe_to_delete("/bin"));
        assert!(!is_safe_to_delete("/sbin"));
        assert!(!is_safe_to_delete("/dev"));
        assert!(!is_safe_to_delete("/usr/bin"));
        assert!(!is_safe_to_delete("/usr/sbin"));
        assert!(!is_safe_to_delete("/private/etc"));
        assert!(!is_safe_to_delete("/private/var/db"));
    }

    #[test]
    fn safe_to_delete_rejects_children_of_blocked() {
        assert!(!is_safe_to_delete("/System/Library"));
        assert!(!is_safe_to_delete("/System/Library/CoreServices/Finder.app"));
        assert!(!is_safe_to_delete("/bin/bash"));
        assert!(!is_safe_to_delete("/usr/bin/env"));
        assert!(!is_safe_to_delete("/private/etc/hosts"));
    }

    #[test]
    fn safe_to_delete_rejects_root() {
        // Root "/" must never be deletable — would wipe the entire system.
        assert!(!is_safe_to_delete("/"));
    }

    #[test]
    fn safe_to_delete_allows_user_paths() {
        assert!(is_safe_to_delete("/Users/alice/Library/Caches/foo"));
        assert!(is_safe_to_delete("/Users/alice/Downloads/big-file.dmg"));
        assert!(is_safe_to_delete("/private/var/folders/xyz/cache"));
    }

    #[test]
    fn safe_to_delete_does_not_confuse_prefix_match() {
        // "/Systema" is NOT the same as "/System" — should be allowed
        assert!(is_safe_to_delete("/Systema/foo"));
        // "/binaries" is NOT "/bin" — should be allowed
        assert!(is_safe_to_delete("/binaries/data"));
    }
}
