mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            commands::get_system_status,
            commands::clean_language_files,
            commands::clean_junk_paths,
            commands::get_installed_apps,
            commands::uninstall_app,
            commands::get_cache_info,
            commands::analyze_junk,
            commands::scan_junk_streaming,
            commands::get_app_version,
            commands::get_login_items,
            commands::toggle_login_item,
            commands::delete_login_item,
            commands::find_duplicate_files,
            commands::trash_duplicate_file,
            commands::get_trash_info,
            commands::get_trash_item_icon,
            commands::restore_trash_item,
            commands::delete_trash_item,
            commands::empty_trash,
            commands::delete_apfs_snapshots,
            commands::get_ram_stats,
            commands::optimize_ram,
            commands::get_privacy_info,
            commands::flush_dns_cache,
            commands::clear_clipboard,
            commands::clean_privacy_all,
            commands::get_home_path,
            commands::browse_directory,
            commands::find_large_files,
            commands::scan_folder_tree,
            commands::request_admin_auth,
            commands::open_system_settings,
            commands::reveal_in_finder,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}