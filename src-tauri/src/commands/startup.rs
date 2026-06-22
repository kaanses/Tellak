use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;

// ── Types ─────────────────────────────────────────────────────────────────────

#[derive(Serialize, Clone)]
pub struct LoginItem {
    pub name: String,
    pub path: String,
    pub program: String,
    pub enabled: bool,
    /// "user"   = ~/Library/LaunchAgents
    /// "global" = /Library/LaunchAgents
    /// "daemon" = /Library/LaunchDaemons
    pub location: String,
    pub is_apple: bool,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn home_dir() -> PathBuf {
    std::env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("/Users/unknown"))
}

fn run_cmd(program: &str, args: &[&str]) -> Option<String> {
    Command::new(program)
        .args(args)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
}

/// Extract the first `<string>` value immediately after `<key>{key}</key>`.
fn plist_str(xml: &str, key: &str) -> Option<String> {
    let needle = format!("<key>{}</key>", key);
    let after = xml.split(&needle).nth(1)?;
    let start = after.find("<string>")? + "<string>".len();
    let end = after[start..].find("</string>")?;
    let v = after[start..start + end].trim().to_string();
    if v.is_empty() { None } else { Some(v) }
}

/// Get the first item from `<key>ProgramArguments</key><array><string>…`.
fn plist_first_arg(xml: &str) -> Option<String> {
    let after_key = xml.split("<key>ProgramArguments</key>").nth(1)?;
    let arr_pos = after_key.find("<array>")?;
    let after_arr = &after_key[arr_pos..];
    let start = after_arr.find("<string>")? + "<string>".len();
    let end = after_arr[start..].find("</string>")?;
    Some(after_arr[start..start + end].trim().to_string())
}

/// Convert any plist (binary or XML) to XML with plutil and extract
/// (label, program_path). Falls back to filename-derived label on failure.
fn parse_plist(path: &Path) -> Option<(String, String)> {
    let xml = run_cmd("plutil", &["-convert", "xml1", "-o", "-", &path.to_string_lossy()])?;
    let label = plist_str(&xml, "Label")
        .or_else(|| path.file_stem().map(|s| s.to_string_lossy().to_string()))?;
    let program = plist_str(&xml, "Program")
        .or_else(|| plist_first_arg(&xml))
        .unwrap_or_default();
    Some((label, program))
}

/// Shell-quote a path with single quotes for embedding in a shell command.
/// The resulting path is safe to include inside a double-quoted AppleScript string.
fn shell_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

/// Run a shell command with macOS admin privileges via osascript.
/// The shell command may contain single-quoted paths (from shell_quote).
/// AppleScript string literals use double quotes; we escape only `\` and `"`.
fn run_privileged(shell_cmd: &str) -> Result<(), String> {
    let escaped = shell_cmd.replace('\\', "\\\\").replace('"', "\\\"");
    let script = format!(
        "do shell script \"{}\" with administrator privileges",
        escaped
    );
    let ok = Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .status()
        .map_err(|e| e.to_string())?
        .success();
    if ok { Ok(()) } else { Err("Administrator authorisation cancelled.".to_string()) }
}

// ── Scan ─────────────────────────────────────────────────────────────────────

fn scan_location(dir: &Path, location: &str) -> Vec<LoginItem> {
    let rd = match std::fs::read_dir(dir) {
        Ok(r) => r,
        Err(_) => return vec![],
    };

    let mut items = Vec::new();

    for entry in rd.filter_map(|e| e.ok()) {
        let path = entry.path();
        let fname = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();

        let enabled = fname.ends_with(".plist");
        if !enabled && !fname.ends_with(".plist.disabled") {
            continue;
        }

        let (name, program) = parse_plist(&path).unwrap_or_else(|| {
            let n = fname
                .trim_end_matches(".disabled")
                .trim_end_matches(".plist")
                .to_string();
            (n, String::new())
        });

        let is_apple = name.starts_with("com.apple.");

        items.push(LoginItem {
            name,
            path: path.to_string_lossy().to_string(),
            program,
            enabled,
            location: location.to_string(),
            is_apple,
        });
    }

    // Non-apple items first, then apple; alphabetical within each group
    items.sort_by(|a, b| {
        a.is_apple
            .cmp(&b.is_apple)
            .then_with(|| a.name.cmp(&b.name))
    });

    items
}

// ── Commands ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_login_items() -> Result<Vec<LoginItem>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let home = home_dir();
        let mut items = Vec::new();
        items.extend(scan_location(&home.join("Library/LaunchAgents"), "user"));
        items.extend(scan_location(Path::new("/Library/LaunchAgents"), "global"));
        items.extend(scan_location(Path::new("/Library/LaunchDaemons"), "daemon"));
        Ok(items)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Enable/disable a login item.
///
/// Agents (~/Library/LaunchAgents, /Library/LaunchAgents):
///   Rename .plist ↔ .plist.disabled — launchd picks this up on next login.
///
/// Daemons (/Library/LaunchDaemons):
///   Rename + immediately unload/load via launchctl so the change takes effect
///   now, not just on the next reboot. Both steps run in one admin prompt.
///   Uses `bootout`/`bootstrap` (modern) with `unload`/`load` fallback.
///
/// Returns the new file path so the frontend can update its local state.
#[tauri::command]
pub async fn toggle_login_item(path: String, enable: bool) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let src = PathBuf::from(&path);
        let is_daemon = path.contains("/Library/LaunchDaemons/");

        let dst = if enable {
            PathBuf::from(path.trim_end_matches(".disabled").to_string())
        } else if path.ends_with(".plist") {
            PathBuf::from(format!("{}.disabled", path))
        } else {
            return Err("Unexpected path format — expected .plist".to_string());
        };

        let src_q = shell_quote(&src.to_string_lossy());
        let dst_q = shell_quote(&dst.to_string_lossy());

        if is_daemon {
            // One admin prompt: rename + launchctl in the correct order.
            let cmd = if enable {
                // Rename first, then load from the new path.
                format!(
                    "mv {src} {dst} && (launchctl bootstrap system {dst} 2>/dev/null || launchctl load {dst} 2>/dev/null); true",
                    src = src_q, dst = dst_q
                )
            } else {
                // Unload first (so we reference the still-existing path), then rename.
                format!(
                    "(launchctl bootout system {src} 2>/dev/null || launchctl unload {src} 2>/dev/null); mv {src} {dst}",
                    src = src_q, dst = dst_q
                )
            };
            run_privileged(&cmd)?;
        } else {
            // Agent: plain rename; escalate if needed.
            match std::fs::rename(&src, &dst) {
                Ok(_) => {}
                Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => {
                    run_privileged(&format!("mv {} {}", src_q, dst_q))?;
                }
                Err(e) => return Err(e.to_string()),
            }
        }

        Ok(dst.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Permanently delete a login item plist.
#[tauri::command]
pub async fn delete_login_item(path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let p = PathBuf::from(&path);
        match std::fs::remove_file(&p) {
            Ok(_) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => {
                let cmd = format!("rm -f {}", shell_quote(&path));
                run_privileged(&cmd)
            }
            Err(e) => Err(e.to_string()),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── shell_quote ────────────────────────────────────────────────────────

    #[test]
    fn shell_quote_simple_path() {
        assert_eq!(shell_quote("/usr/bin/env"), "'/usr/bin/env'");
    }

    #[test]
    fn shell_quote_path_with_spaces() {
        assert_eq!(shell_quote("/Applications/My App.app"), "'/Applications/My App.app'");
    }

    #[test]
    fn shell_quote_path_with_single_quote() {
        // "O'Malley" → 'O'\''Malley'
        assert_eq!(shell_quote("O'Malley"), "'O'\\''Malley'");
    }

    #[test]
    fn shell_quote_empty_string() {
        assert_eq!(shell_quote(""), "''");
    }

    // ── plist_str ──────────────────────────────────────────────────────────

    const SAMPLE_PLIST: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.example.agent</string>
    <key>Program</key>
    <string>/usr/local/bin/my-daemon</string>
    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>"#;

    #[test]
    fn plist_str_existing_key() {
        assert_eq!(
            plist_str(SAMPLE_PLIST, "Label"),
            Some("com.example.agent".to_string())
        );
    }

    #[test]
    fn plist_str_second_key() {
        assert_eq!(
            plist_str(SAMPLE_PLIST, "Program"),
            Some("/usr/local/bin/my-daemon".to_string())
        );
    }

    #[test]
    fn plist_str_missing_key_returns_none() {
        assert_eq!(plist_str(SAMPLE_PLIST, "NonExistentKey"), None);
    }

    #[test]
    fn plist_str_non_string_value_returns_none() {
        // "RunAtLoad" has a <true/> value, not <string>
        assert_eq!(plist_str(SAMPLE_PLIST, "RunAtLoad"), None);
    }

    #[test]
    fn plist_str_empty_xml() {
        assert_eq!(plist_str("", "Label"), None);
    }

    // ── plist_first_arg ────────────────────────────────────────────────────

    const PLIST_WITH_ARGS: &str = r#"<dict>
    <key>Label</key>
    <string>com.example.agent</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/my-daemon</string>
        <string>--foreground</string>
    </array>
</dict>"#;

    #[test]
    fn plist_first_arg_returns_first_string() {
        assert_eq!(
            plist_first_arg(PLIST_WITH_ARGS),
            Some("/usr/local/bin/my-daemon".to_string())
        );
    }

    #[test]
    fn plist_first_arg_missing_key_returns_none() {
        assert_eq!(plist_first_arg(SAMPLE_PLIST), None);
    }

    #[test]
    fn plist_first_arg_empty_xml() {
        assert_eq!(plist_first_arg(""), None);
    }
}
