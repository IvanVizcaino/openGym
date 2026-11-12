#!/bin/sh
# Put SITE_NAME into the app shell's <title> and share meta so link previews (WhatsApp,
# Telegram, …) show the gym's name without running JS. Admin → Site still wins once the app
# loads (App.jsx). Empty / unset / openGym leaves the shipped shell alone. Only the four
# branding spots below are rewritten — boot copy that mentions openGym stays as it is, and
# the CSP hash of the inline script is untouched.
set -eu
NAME="${SITE_NAME:-}"
NAME=$(printf '%s' "$NAME" | tr '\n\r\t' '   ' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | cut -c1-40)
[ -n "$NAME" ] || exit 0
[ "$NAME" = openGym ] && exit 0
html=/usr/share/nginx/html/index.html
[ -f "$html" ] || exit 0
esc=$(printf '%s' "$NAME" | sed 's/[&\\]/\\&/g')
tmp=$(mktemp)
sed \
  -e "s/<title>openGym<\/title>/<title>${esc}<\/title>/" \
  -e "s/property=\"og:title\" content=\"openGym\"/property=\"og:title\" content=\"${esc}\"/" \
  -e "s/property=\"og:site_name\" content=\"openGym\"/property=\"og:site_name\" content=\"${esc}\"/" \
  -e "s/name=\"twitter:title\" content=\"openGym\"/name=\"twitter:title\" content=\"${esc}\"/" \
  -e "s/name=\"apple-mobile-web-app-title\" content=\"openGym\"/name=\"apple-mobile-web-app-title\" content=\"${esc}\"/" \
  "$html" > "$tmp" || { rm -f "$tmp"; exit 0; }
# uid 101 must own index.html (Dockerfile). If a host mount made it read-only, leave the
# shipped title rather than aborting nginx start.
if ! cat "$tmp" > "$html"; then
  echo "10-site-name.sh: index.html not writable, leaving shipped title" >&2
  rm -f "$tmp"
  exit 0
fi
rm -f "$tmp"
