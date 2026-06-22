use serde::Serialize;

#[derive(Serialize)]
pub struct AppVersion {
    pub version: String,
    pub name: String,
}

#[tauri::command]
pub fn get_app_version() -> AppVersion {
    AppVersion {
        version: env!("CARGO_PKG_VERSION").to_string(),
        name: env!("CARGO_PKG_NAME").to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_matches_cargo_env() {
        let v = get_app_version();
        assert_eq!(v.version, env!("CARGO_PKG_VERSION"));
        assert_eq!(v.name, env!("CARGO_PKG_NAME"));
        assert!(!v.version.is_empty());
    }
}
