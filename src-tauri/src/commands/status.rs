use serde::Serialize;
use std::collections::HashMap;
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};
use sysinfo::{Disks, Networks, System};

// ── Structs (PascalCase JSON to match frontend) ────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "PascalCase")]
pub struct MetricsSnapshot {
    pub host: String,
    pub platform: String,
    pub uptime: String,
    pub uptime_secs: u64,
    pub hardware: HardwareInfo,
    pub health_score: u32,
    pub health_score_msg: String,
    #[serde(rename = "CPU")]
    pub cpu: CPUStatus,
    pub memory: MemoryStatus,
    pub disks: Vec<DiskStatus>,
    pub batteries: Vec<BatteryStatus>,
    pub thermal: ThermalStatus,
    pub network: Vec<NetworkStatus>,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "PascalCase")]
pub struct HardwareInfo {
    pub model: String,
    #[serde(rename = "OSVersion")]
    pub os_version: String,
}

#[derive(Serialize)]
#[serde(rename_all = "PascalCase")]
pub struct CPUStatus {
    pub usage: f64,
    pub core_count: usize,
    #[serde(rename = "PCoreCount")]
    pub p_core_count: usize,
    #[serde(rename = "ECoreCount")]
    pub e_core_count: usize,
    pub load1: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "PascalCase")]
pub struct MemoryStatus {
    pub used: u64,
    pub total: u64,
    pub used_percent: f64,
    pub pressure: String,
    pub swap_used: u64,
    pub swap_total: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "PascalCase")]
pub struct DiskStatus {
    pub mount: String,
    pub used: u64,
    pub total: u64,
    pub used_percent: f64,
    pub external: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "PascalCase")]
pub struct BatteryStatus {
    pub percent: f64,
    pub status: String,
    pub time_left: String,
    pub health: String,
    pub cycle_count: u64,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "PascalCase")]
pub struct ThermalStatus {
    /// Battery cell temperature from AppleSmartBattery (°C).
    /// Note: this is NOT CPU/SoC temperature — Apple Silicon CPU temps
    /// require powermetrics (sudo) or private IOKit entitlements.
    #[serde(rename = "BatteryTemp")]
    pub battery_temp: f64,
    #[serde(rename = "GPUTemp")]
    pub gpu_temp: f64,
    pub fan_speed: u64,
    pub system_power: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "PascalCase")]
pub struct NetworkStatus {
    /// Human-friendly name: "Wi-Fi", "Ethernet", etc. Falls back to device name.
    pub name: String,
    /// Raw device identifier: "en0", "en1", etc.
    pub device: String,
    #[serde(rename = "RxRateMBs")]
    pub rx_rate_mbs: f64,
    #[serde(rename = "TxRateMBs")]
    pub tx_rate_mbs: f64,
}

// ── Shell helper ───────────────────────────────────────────────────────

fn run_cmd(program: &str, args: &[&str]) -> Option<String> {
    run_cmd_timeout(program, args, Duration::from_secs(5))
}

fn run_cmd_timeout(program: &str, args: &[&str], timeout: Duration) -> Option<String> {
    let mut child = Command::new(program)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;

    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                if !status.success() {
                    return None;
                }
                let output = child.wait_with_output().ok()?;
                return Some(String::from_utf8_lossy(&output.stdout).trim().to_string());
            }
            Ok(None) => {
                if start.elapsed() > timeout {
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

fn sysctl_string(key: &str) -> Option<String> {
    run_cmd("sysctl", &["-n", key])
}

fn sysctl_u64(key: &str) -> Option<u64> {
    sysctl_string(key).and_then(|s| s.parse().ok())
}

// ── Collectors ─────────────────────────────────────────────────────────

fn collect_cpu(sys: &System) -> CPUStatus {
    let usage: f64 = if sys.cpus().is_empty() {
        0.0
    } else {
        sys.cpus().iter().map(|c| c.cpu_usage() as f64).sum::<f64>() / sys.cpus().len() as f64
    };

    let load = System::load_average();

    let p_cores = sysctl_u64("hw.perflevel0.logicalcpu").unwrap_or(0) as usize;
    let e_cores = sysctl_u64("hw.perflevel1.logicalcpu").unwrap_or(0) as usize;

    CPUStatus {
        usage: (usage * 10.0).round() / 10.0,
        core_count: sys.cpus().len(),
        p_core_count: p_cores,
        e_core_count: e_cores,
        load1: (load.one * 100.0).round() / 100.0,
    }
}

fn collect_memory(sys: &System) -> MemoryStatus {
    let total = sys.total_memory();
    let used = sys.used_memory();
    let pct = if total > 0 {
        (used as f64 / total as f64) * 100.0
    } else {
        0.0
    };

    let pressure = sysctl_u64("kern.memorystatus_vm_pressure_level")
        .map(|v| match v {
            1 => "warning",
            2 => "urgent",
            4 => "critical",
            _ => "normal",
        })
        .unwrap_or("normal")
        .to_string();

    MemoryStatus {
        used,
        total,
        used_percent: (pct * 10.0).round() / 10.0,
        pressure,
        swap_used: sys.used_swap(),
        swap_total: sys.total_swap(),
    }
}

fn collect_disks() -> Vec<DiskStatus> {
    let disks = Disks::new_with_refreshed_list();
    let mut seen_mounts = std::collections::HashSet::new();
    disks
        .list()
        .iter()
        .filter(|d| {
            let mount = d.mount_point().to_string_lossy();
            // Skip snapshot/vm/preboot volumes (keep Data and root)
            !mount.contains("/System/Volumes/")
                || mount == "/System/Volumes/Data"
        })
        .filter_map(|d| {
            let total = d.total_space();
            let available = d.available_space();
            let used = total.saturating_sub(available);
            let pct = if total > 0 {
                (used as f64 / total as f64) * 100.0
            } else {
                0.0
            };

            let mount_str = d.mount_point().to_string_lossy().to_string();
            let display_mount = if mount_str == "/System/Volumes/Data" {
                "/".to_string()
            } else {
                mount_str
            };

            // Deduplicate by mount point (macOS reports / and /System/Volumes/Data as same disk)
            if !seen_mounts.insert(display_mount.clone()) {
                return None;
            }

            // Detect external disks via diskutil
            let external = if let Some(dev) = d.name().to_str() {
                is_external_disk(dev)
            } else {
                false
            };

            Some(DiskStatus {
                mount: display_mount,
                used,
                total,
                used_percent: (pct * 10.0).round() / 10.0,
                external,
            })
        })
        .collect()
}

fn is_external_disk(device_name: &str) -> bool {
    run_cmd("diskutil", &["info", device_name])
        .map(|output| {
            output
                .lines()
                .any(|l| l.contains("Internal:") && l.contains("No"))
        })
        .unwrap_or(false)
}

/// Builds a device → friendly-name map via `networksetup -listallhardwareports`.
/// e.g. "en0" → "Wi-Fi", "en1" → "Thunderbolt Ethernet"
fn resolve_interface_names() -> HashMap<String, String> {
    let output = run_cmd("networksetup", &["-listallhardwareports"]).unwrap_or_default();
    let mut map = HashMap::new();
    let mut current_port: Option<String> = None;
    for line in output.lines() {
        let t = line.trim();
        if let Some(port) = t.strip_prefix("Hardware Port: ") {
            current_port = Some(port.to_string());
        } else if let Some(dev) = t.strip_prefix("Device: ") {
            if let Some(port) = current_port.take() {
                map.insert(dev.to_string(), port);
            }
        }
    }
    map
}

fn collect_network(networks: &Networks, iface_names: &HashMap<String, String>) -> Vec<NetworkStatus> {
    networks
        .list()
        .iter()
        .filter(|(device, data)| {
            // Physical en* interfaces (Wi-Fi, Ethernet) that have ever carried traffic
            let has_traffic = data.total_received() > 0 || data.total_transmitted() > 0;
            let is_physical = device.starts_with("en");
            has_traffic && is_physical
        })
        .map(|(device, data)| {
            // bytes in the 500 ms window → ÷ 0.5 for per-second rate (MB/s)
            let rx = data.received() as f64 / (1024.0 * 1024.0 * 0.5);
            let tx = data.transmitted() as f64 / (1024.0 * 1024.0 * 0.5);
            let name = iface_names
                .get(device.as_str())
                .cloned()
                .unwrap_or_else(|| device.to_string());
            NetworkStatus {
                name,
                device: device.to_string(),
                rx_rate_mbs: (rx * 100.0).round() / 100.0,
                tx_rate_mbs: (tx * 100.0).round() / 100.0,
            }
        })
        .collect()
}

fn collect_battery() -> Vec<BatteryStatus> {
    let Some(pmset) = run_cmd("pmset", &["-g", "batt"]) else {
        return vec![];
    };

    // Example line: " -InternalBattery-0 (id=...)	85%; charging; 1:30 remaining"
    let mut batteries = Vec::new();
    for line in pmset.lines() {
        if !line.contains("InternalBattery") {
            continue;
        }
        let percent = extract_battery_percent(line).unwrap_or(0.0);
        let status = if line.contains("charging") && !line.contains("not charging") {
            "Charging"
        } else if line.contains("discharging") {
            "Discharging"
        } else if line.contains("charged") || line.contains("finishing charge") {
            "Full"
        } else if line.contains("AC attached") || line.contains("not charging") {
            "AC Power"
        } else {
            "Unknown"
        }
        .to_string();

        let time_left = extract_time_remaining(line).unwrap_or_default();

        let (health, cycles) = get_battery_health();

        batteries.push(BatteryStatus {
            percent,
            status,
            time_left,
            health,
            cycle_count: cycles,
        });
    }
    batteries
}

fn extract_battery_percent(line: &str) -> Option<f64> {
    // Find pattern like "85%"
    let pct_idx = line.find('%')?;
    let start = line[..pct_idx].rfind(|c: char| !c.is_ascii_digit())?;
    line[start + 1..pct_idx].parse().ok()
}

fn extract_time_remaining(line: &str) -> Option<String> {
    if line.contains("(no estimate)") || line.contains("not charging") {
        return None;
    }
    // Pattern: "1:30 remaining"
    let remaining_idx = line.find("remaining")?;
    let before = line[..remaining_idx].trim();
    let time = before.rsplit(';').next()?.trim();
    if time.contains(':') {
        Some(time.to_string())
    } else {
        None
    }
}

fn get_battery_health() -> (String, u64) {
    let output = run_cmd("system_profiler", &["SPPowerDataType"]).unwrap_or_default();

    let mut health = "Normal".to_string();
    let mut cycles: u64 = 0;

    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("Condition:") || trimmed.starts_with("Condition (Translated):") {
            health = trimmed
                .split(':')
                .nth(1)
                .map(|s| s.trim().to_string())
                .unwrap_or_else(|| "Normal".to_string());
        }
        if trimmed.starts_with("Cycle Count:") {
            cycles = trimmed
                .split(':')
                .nth(1)
                .and_then(|s| s.trim().parse().ok())
                .unwrap_or(0);
        }
    }
    (health, cycles)
}

fn collect_thermal() -> ThermalStatus {
    let mut temp = 0.0_f64;
    let mut power = 0.0_f64;

    // Try ioreg for Apple Smart Battery / thermal data
    if let Some(output) = run_cmd("ioreg", &["-rn", "AppleSmartBattery"]) {
        for line in output.lines() {
            let trimmed = line.trim();
            if trimmed.contains("\"Temperature\"") {
                // Temperature is in centi-degrees (e.g. 3215 = 32.15°C)
                if let Some(val) = extract_ioreg_number(trimmed) {
                    temp = val / 100.0; // centi-degrees → °C
                }
            }
        }
    }

    // System power from pmset
    if let Some(output) = run_cmd("pmset", &["-g", "thermlog"]) {
        for line in output.lines() {
            if line.contains("CPU_Power") {
                if let Some(val) = line.split_whitespace().last().and_then(|s| s.parse::<f64>().ok())
                {
                    power = val;
                }
            }
        }
    }

    // Fan speed: try sysctl
    let fan_speed = sysctl_u64("machdep.xcpm.fan_speed_rpm").unwrap_or(0);

    ThermalStatus {
        battery_temp: (temp * 10.0).round() / 10.0,
        gpu_temp: 0.0,
        fan_speed,
        system_power: (power * 10.0).round() / 10.0,
    }
}

fn extract_ioreg_number(line: &str) -> Option<f64> {
    // Pattern: "key" = 12345
    let eq_idx = line.find('=')?;
    let after = line[eq_idx + 1..].trim();
    after.parse::<f64>().ok()
}

fn collect_hardware() -> HardwareInfo {
    let model = sysctl_string("hw.model").unwrap_or_else(|| "Unknown".to_string());

    // Get friendly model name from system_profiler
    let friendly = run_cmd("system_profiler", &["SPHardwareDataType"])
        .and_then(|output| {
            output.lines().find_map(|l| {
                let trimmed = l.trim();
                if trimmed.starts_with("Model Name:") || trimmed.starts_with("Chip:") {
                    trimmed.split(':').nth(1).map(|s| s.trim().to_string())
                } else {
                    None
                }
            })
        })
        .unwrap_or(model);

    let os_version =
        run_cmd("sw_vers", &["-productVersion"]).unwrap_or_else(|| "Unknown".to_string());

    HardwareInfo {
        model: friendly,
        os_version: format!("macOS {}", os_version),
    }
}

fn collect_host() -> String {
    sysctl_string("kern.hostname").unwrap_or_else(|| "Unknown".to_string())
}

/// Returns (formatted_string, total_seconds) for uptime.
fn uptime_info() -> (String, u64) {
    let boot = System::boot_time();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let secs = now.saturating_sub(boot);
    let days = secs / 86400;
    let hours = (secs % 86400) / 3600;
    let mins = (secs % 3600) / 60;

    let formatted = if days > 0 {
        format!("{}d {}h {}m", days, hours, mins)
    } else if hours > 0 {
        format!("{}h {}m", hours, mins)
    } else {
        format!("{}m", mins)
    };

    (formatted, secs)
}

fn calculate_health(cpu: &CPUStatus, mem: &MemoryStatus, disks: &[DiskStatus], thermal: &ThermalStatus) -> (u32, String) {
    use super::analyze::get_cached_junk_total;
    let mut score: f64 = 100.0;

    // CPU penalty
    if cpu.usage > 90.0 {
        score -= 25.0;
    } else if cpu.usage > 70.0 {
        score -= 15.0;
    } else if cpu.usage > 50.0 {
        score -= 5.0;
    }

    // Memory penalty
    if mem.used_percent > 90.0 {
        score -= 25.0;
    } else if mem.used_percent > 75.0 {
        score -= 15.0;
    } else if mem.used_percent > 60.0 {
        score -= 5.0;
    }

    // Memory pressure penalty
    match mem.pressure.as_str() {
        "critical" => score -= 20.0,
        "urgent" => score -= 10.0,
        "warning" => score -= 5.0,
        _ => {}
    }

    // Disk penalty (worst disk)
    if let Some(worst) = disks.iter().map(|d| d.used_percent).reduce(f64::max) {
        if worst > 95.0 {
            score -= 25.0;
        } else if worst > 85.0 {
            score -= 15.0;
        } else if worst > 75.0 {
            score -= 5.0;
        }
    }

    // Thermal penalty (based on battery temperature as proxy)
    if thermal.battery_temp > 45.0 {
        score -= 20.0;
    } else if thermal.battery_temp > 38.0 {
        score -= 10.0;
    }

    // Junk penalty — only applied once the user has run a scan
    if let Some(junk_bytes) = get_cached_junk_total() {
        const GB: u64 = 1024 * 1024 * 1024;
        if junk_bytes > 20 * GB {
            score -= 25.0;
        } else if junk_bytes > 10 * GB {
            score -= 15.0;
        } else if junk_bytes > 5 * GB {
            score -= 10.0;
        } else if junk_bytes > GB {
            score -= 5.0;
        }
    }

    let score = score.max(0.0) as u32;
    let msg = match score {
        80..=100 => "Excellent",
        60..=79 => "Good",
        40..=59 => "Fair",
        _ => "Poor",
    }
    .to_string();

    (score, msg)
}

// ── Tauri command ──────────────────────────────────────────────────────

fn do_collect() -> Result<MetricsSnapshot, String> {
    // Spawn all subprocess-heavy collectors BEFORE the CPU/network sleep so they
    // run in parallel during the 500 ms wait instead of sequentially after it.
    let h_disks       = thread::spawn(collect_disks);
    let h_thermal     = thread::spawn(collect_thermal);
    let h_battery     = thread::spawn(collect_battery);
    let h_hardware    = thread::spawn(collect_hardware);
    let h_iface_names = thread::spawn(resolve_interface_names);

    // CPU and network both need a sample interval — initialise before the sleep.
    let mut sys = System::new_all();
    let mut networks = Networks::new_with_refreshed_list();
    std::thread::sleep(Duration::from_millis(500));
    sys.refresh_all();
    networks.refresh(false);

    // Fast in-process collectors.
    let cpu         = collect_cpu(&sys);
    let memory      = collect_memory(&sys);
    let iface_names = h_iface_names.join().unwrap_or_default();
    let network     = collect_network(&networks, &iface_names);
    let host        = collect_host();
    let (uptime, uptime_secs) = uptime_info();

    // Join parallel subprocess results — they've been running during the sleep.
    let disks     = h_disks.join().unwrap_or_default();
    let thermal   = h_thermal.join().unwrap_or_default();
    let batteries = h_battery.join().unwrap_or_default();
    let hardware  = h_hardware.join().unwrap_or_default();

    let (health_score, health_score_msg) = calculate_health(&cpu, &memory, &disks, &thermal);

    Ok(MetricsSnapshot {
        host,
        platform: "macOS".to_string(),
        uptime,
        uptime_secs,
        hardware,
        health_score,
        health_score_msg,
        cpu,
        memory,
        disks,
        batteries,
        thermal,
        network,
    })
}

#[tauri::command]
pub async fn get_system_status() -> Result<MetricsSnapshot, String> {
    tauri::async_runtime::spawn_blocking(do_collect)
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_get_system_status() {
        let result = get_system_status().await;
        assert!(result.is_ok(), "get_system_status failed: {:?}", result.err());
        let snapshot = result.unwrap();

        // Verify basic fields
        assert!(!snapshot.host.is_empty(), "Host should not be empty");
        assert_eq!(snapshot.platform, "macOS");
        assert!(!snapshot.uptime.is_empty(), "Uptime should not be empty");
        assert!(snapshot.health_score <= 100, "Health score should be <= 100");
        assert!(!snapshot.health_score_msg.is_empty());

        // CPU
        assert!(snapshot.cpu.core_count > 0, "Should have at least 1 core");
        assert!(snapshot.cpu.usage >= 0.0 && snapshot.cpu.usage <= 100.0);

        // Memory
        assert!(snapshot.memory.total > 0, "Total memory should be > 0");
        assert!(snapshot.memory.used_percent >= 0.0 && snapshot.memory.used_percent <= 100.0);

        // Disks
        assert!(!snapshot.disks.is_empty(), "Should have at least 1 disk");
        assert!(snapshot.disks[0].total > 0);

        // Hardware
        assert!(!snapshot.hardware.model.is_empty());
        assert!(snapshot.hardware.os_version.starts_with("macOS"));

        let json = serde_json::to_string_pretty(&snapshot).unwrap();
        assert!(!json.is_empty());
    }

    // ── extract_battery_percent ────────────────────────────────────────────

    #[test]
    fn battery_percent_normal() {
        let line = " -InternalBattery-0 (id=1234)\t85%; charging; 1:30 remaining";
        assert_eq!(extract_battery_percent(line), Some(85.0));
    }

    #[test]
    fn battery_percent_100() {
        let line = " -InternalBattery-0 (id=1234)\t100%; charged; 0:00 remaining";
        assert_eq!(extract_battery_percent(line), Some(100.0));
    }

    #[test]
    fn battery_percent_single_digit() {
        let line = " -InternalBattery-0 (id=1234)\t3%; discharging; 0:15 remaining";
        assert_eq!(extract_battery_percent(line), Some(3.0));
    }

    #[test]
    fn battery_percent_missing() {
        assert_eq!(extract_battery_percent("no percent here"), None);
    }

    // ── extract_time_remaining ─────────────────────────────────────────────

    #[test]
    fn time_remaining_normal() {
        let line = " -InternalBattery-0\t85%; discharging; 1:30 remaining";
        assert_eq!(extract_time_remaining(line), Some("1:30".to_string()));
    }

    #[test]
    fn time_remaining_no_estimate() {
        let line = " -InternalBattery-0\t85%; charging; (no estimate) remaining";
        assert_eq!(extract_time_remaining(line), None);
    }

    #[test]
    fn time_remaining_not_charging() {
        let line = " -InternalBattery-0\t100%; not charging; 0:00 remaining";
        assert_eq!(extract_time_remaining(line), None);
    }

    #[test]
    fn time_remaining_missing_remaining_word() {
        assert_eq!(extract_time_remaining("no time here"), None);
    }

    // ── extract_ioreg_number ───────────────────────────────────────────────

    #[test]
    fn ioreg_number_integer() {
        let line = "    \"Temperature\" = 3215";
        assert_eq!(extract_ioreg_number(line), Some(3215.0));
    }

    #[test]
    fn ioreg_number_float() {
        let line = "    \"Voltage\" = 12345.6";
        assert_eq!(extract_ioreg_number(line), Some(12345.6));
    }

    #[test]
    fn ioreg_number_missing_equals() {
        assert_eq!(extract_ioreg_number("no equals sign here"), None);
    }

    #[test]
    fn ioreg_number_non_numeric_value() {
        let line = "    \"Status\" = \"Good\"";
        assert_eq!(extract_ioreg_number(line), None);
    }
}
