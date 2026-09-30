from pathlib import Path

assets = Path("build/darwin").resolve()

format = "UDZO"
filesystem = "HFS+"
files = [defines["app"]]
symlinks = {"Applications": "/Applications"}
background = str(assets / "dmg-background.png")

window_rect = ((160, 160), (800, 380))
default_view = "icon-view"
show_toolbar = False
show_sidebar = False
show_status_bar = False
show_pathbar = False
show_tab_view = False
arrange_by = None
grid_spacing = 64
icon_size = 96
text_size = 14
label_pos = "bottom"
icon_locations = {
    "LightRemote.app": (170, 214),
    "Applications": (630, 214),
}
