#!/bin/sh
set -eu

arch=${1:?Usage: sh build/darwin/package.sh <amd64|arm64>}
case "$arch" in
    amd64) native_arch=x86_64 ;;
    arm64) native_arch=arm64 ;;
    *) printf 'Unsupported macOS architecture: %s\n' "$arch" >&2; exit 1 ;;
esac

lipo bin/lightremote-desktop -verify_arch "$native_arch"
plutil -lint build/darwin/Info.plist

tools="$PWD/bin/.dmg-tools"
if [ ! -x "$tools/bin/python" ]; then
    python3 -m venv "$tools"
fi
if ! "$tools/bin/python" -c 'from importlib.metadata import version; assert version("dmgbuild") == "1.6.7"' 2>/dev/null; then
    "$tools/bin/python" -m pip install --disable-pip-version-check 'dmgbuild==1.6.7'
fi

staging=$(mktemp -d "$PWD/bin/.dmg-$arch.XXXXXX")
mounted=false
cleanup() {
    if [ "$mounted" = true ]; then
        hdiutil detach "$staging/mount" >/dev/null || true
    fi
    rm -rf "$staging"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

app="$staging/image/LightRemote.app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
cp bin/lightremote-desktop "$app/Contents/MacOS/lightremote-desktop"
chmod 755 "$app/Contents/MacOS/lightremote-desktop"
cp build/darwin/icons.icns "$app/Contents/Resources/icons.icns"
cp build/darwin/Info.plist "$app/Contents/Info.plist"
codesign --force --sign - "$app"
codesign --verify --deep --strict "$app"

"$tools/bin/python" -m dmgbuild -s build/darwin/dmg-settings.py \
    -D "app=$app" LightRemote "$staging/LightRemote.dmg"
hdiutil verify "$staging/LightRemote.dmg"
mkdir "$staging/mount"
hdiutil attach -readonly -nobrowse -mountpoint "$staging/mount" "$staging/LightRemote.dmg"
mounted=true

app="$staging/mount/LightRemote.app"
test -x "$app/Contents/MacOS/lightremote-desktop"
test -s "$app/Contents/Resources/icons.icns"
test -s "$staging/mount/.DS_Store"
test -s "$staging/mount/.background.tiff"
test "$(readlink "$staging/mount/Applications")" = /Applications
plutil -lint "$app/Contents/Info.plist"
lipo "$app/Contents/MacOS/lightremote-desktop" -verify_arch "$native_arch"
codesign --verify --deep --strict "$app"
"$tools/bin/python" - "$staging/mount" <<'PY'
import runpy
import sys
from pathlib import Path

from ds_store import DSStore

mount = Path(sys.argv[1])
settings = runpy.run_path("build/darwin/dmg-settings.py", init_globals={
    "defines": {"app": str(mount / "LightRemote.app")},
})
(x, y), (width, height) = settings["window_rect"]
with DSStore.open(str(mount / ".DS_Store"), "r") as store:
    window = store["."]["bwsp"]
    view = store["."]["icvp"]
    assert window["WindowBounds"] == f"{{{{{x}, {y}}}, {{{width}, {height}}}}}"
    assert not window["ShowToolbar"] and not window["ShowSidebar"]
    assert store["."]["icvl"] == (b"type", b"icnv")
    assert view["iconSize"] == settings["icon_size"]
    assert view["backgroundType"] == 2 and view["backgroundImageAlias"]
    for name, position in settings["icon_locations"].items():
        assert store[name]["Iloc"] == position
print("Finder window, icon positions, and background settings verified")
PY
hdiutil detach "$staging/mount"
mounted=false

output="bin/lightremote-darwin-$arch.dmg"
mv -f "$staging/LightRemote.dmg" "$output"
printf 'Created %s\n' "$output"
