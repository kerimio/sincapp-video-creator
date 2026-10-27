#!/bin/bash
# sincapp Story-Generator – per Doppelklick starten (macOS).
# Beim ersten Start wird alles Nötige installiert; danach öffnet sich der Browser.
cd "$(dirname "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

fail() {
  echo
  echo "✗ $1"
  echo
  read -r -p "Zum Schließen Enter drücken …"
  exit 1
}

echo "sincapp Story-Generator"
echo "======================="

# 1. Programme: Node, ffmpeg, Python (über Homebrew)
need=()
node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>20||(a===20&&b>=12)?0:1)' 2>/dev/null || need+=(node)
command -v ffmpeg >/dev/null || need+=(ffmpeg)
PY=""
for p in python3.13 python3.12 python3.11 python3.10 python3; do
  if command -v "$p" >/dev/null && "$p" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' 2>/dev/null; then PY="$p"; break; fi
done
[ -z "$PY" ] && need+=(python@3.12)
if [ ${#need[@]} -gt 0 ]; then
  command -v brew >/dev/null || fail "Es fehlen: ${need[*]}. Bitte zuerst Homebrew installieren (https://brew.sh) und diese Datei dann noch mal starten."
  echo "→ Installiere ${need[*]} (einmalig, dauert ein paar Minuten) …"
  brew install "${need[@]}" || fail "Installation von ${need[*]} fehlgeschlagen."
  [ -z "$PY" ] && PY="$(brew --prefix)/bin/python3.12"
fi

# 2. pnpm (ohne globale Installation)
if command -v pnpm >/dev/null; then PNPM=(pnpm); else PNPM=(npx --yes pnpm@10.28.0); fi

# 3. Abhängigkeiten – nur wenn sich etwas geändert hat
stamp="$(cat package.json pnpm-lock.yaml requirements.txt | shasum | cut -c1-16)"
if [ "$(cat .cache/installed 2>/dev/null)" != "$stamp" ]; then
  echo "→ Installiere Abhängigkeiten (einmalig, kann 5–10 Minuten dauern) …"
  "${PNPM[@]}" install --frozen-lockfile || fail "pnpm install fehlgeschlagen."
  "${PNPM[@]}" exec playwright install chromium || fail "Browser für das Rendern konnte nicht geladen werden."
  if [ ! -x .venv/bin/python ]; then "$PY" -m venv .venv || fail "Python-Umgebung konnte nicht angelegt werden."; fi
  .venv/bin/pip install -q -r requirements.txt || fail "Python-Pakete konnten nicht installiert werden."
  mkdir -p .cache && echo "$stamp" > .cache/installed
fi

# 4. App starten (öffnet den Browser)
echo
"${PNPM[@]}" cli app
fail "Die App wurde beendet."
