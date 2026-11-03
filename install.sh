#!/usr/bin/env bash
# Install (or update) the extension for the current user.
set -euo pipefail
cd "$(dirname "$0")"
UUID=$(sed -n 's/.*"uuid": *"\([^"]*\)".*/\1/p' metadata.json)
DEST="$HOME/.local/share/gnome-shell/extensions/$UUID"
glib-compile-schemas --strict schemas/
mkdir -p "$DEST/schemas"
cp metadata.json extension.js prefs.js secret.js "$DEST/"
cp schemas/*.xml schemas/gschemas.compiled "$DEST/schemas/"
mkdir -p "$DEST/icons"
cp icons/*.svg "$DEST/icons/"
echo "Installed to $DEST"
echo "Log out and back in (Wayland) or press Alt+F2 → r (X11), then run:"
echo "  gnome-extensions enable $UUID"
