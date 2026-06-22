use serde::Serialize;
use sysinfo::System;

#[derive(Serialize)]
pub struct RamStats {
    pub total: u64,
    pub used: u64,
    pub available: u64,
    pub used_percent: f64,
    pub total_human: String,
    pub used_human: String,
    pub available_human: String,
}

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

#[tauri::command]
pub async fn get_ram_stats() -> Result<RamStats, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut sys = System::new();
        sys.refresh_memory();
        let total     = sys.total_memory();
        let used      = sys.used_memory();
        let available = sys.available_memory();
        let used_percent = if total > 0 { (used as f64 / total as f64) * 100.0 } else { 0.0 };
        Ok(RamStats {
            total, used, available, used_percent,
            total_human:     humanize_bytes(total),
            used_human:      humanize_bytes(used),
            available_human: humanize_bytes(available),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn optimize_ram() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| {
        // Snapshot available RAM before purge
        let mut sys = System::new();
        sys.refresh_memory();
        let before = sys.available_memory();

        let script = r#"do shell script "/usr/sbin/purge" with administrator privileges"#;
        let out = std::process::Command::new("osascript")
            .args(["-e", script])
            .output()
            .map_err(|e| e.to_string())?;

        if !out.status.success() {
            return Err(String::from_utf8_lossy(&out.stderr).to_string());
        }

        // Snapshot after and report the delta
        sys.refresh_memory();
        let after = sys.available_memory();
        let freed = after.saturating_sub(before);
        Ok(humanize_bytes(freed))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn humanize_zero_and_bytes() {
        assert_eq!(humanize_bytes(0), "0 B");
        assert_eq!(humanize_bytes(512), "512 B");
        assert_eq!(humanize_bytes(1023), "1023 B");
    }

    #[test]
    fn humanize_scales_up() {
        assert_eq!(humanize_bytes(1024), "1.0 KB");
        assert_eq!(humanize_bytes(1536), "1.5 KB");
        assert_eq!(humanize_bytes(1_048_576), "1.0 MB");
        assert_eq!(humanize_bytes(1_073_741_824), "1.0 GB");
        assert_eq!(humanize_bytes(1_099_511_627_776), "1.0 TB");
    }
}
