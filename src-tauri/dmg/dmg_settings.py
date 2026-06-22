# dmgbuild settings for the Tellak installer DMG.
#
# Deterministic, Finder-free DMG layout: dmgbuild writes the .DS_Store directly
# via the ds_store/mac_alias libs, so the branded background + icon positions
# work headlessly (CI) and on macOS 26 (Tahoe), unlike Tauri's Finder-scripted
# bundler which silently no-ops without a live Finder session.
#
# Usage:
#   APP_PATH=/path/Tellak.app BACKGROUND=src-tauri/dmg/background.png \
#     dmgbuild -s src-tauri/dmg/dmg_settings.py "Tellak" out.dmg
import os

app_path = os.environ["APP_PATH"]
background_path = os.environ["BACKGROUND"]  # caller passes the absolute path
app_name = os.path.basename(app_path)

# ── Contents ──────────────────────────────────────────────────────────────────
files = [app_path]
symlinks = {"Applications": "/Applications"}

# ── Window / view ─────────────────────────────────────────────────────────────
format = "UDZO"               # compressed, read-only — matches what we ship
background = background_path
default_view = "icon-view"
show_status_bar = False
show_tab_view = False
show_toolbar = False
show_pathbar = False
show_sidebar = False

# 700x480 window; background.png is 2x (1400x960) and maps onto it crisply.
window_rect = ((200, 200), (700, 480))

icon_size = 160               # big, prominent icons (Tauri hard-locks at 128)
text_size = 13

# Icon centers — must straddle the arrow baked into the background (y≈250).
icon_locations = {
    app_name: (170, 250),
    "Applications": (530, 250),
}
