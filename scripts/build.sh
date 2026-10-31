#!/usr/bin/env bash
# Build the Chrome Web Store package: dist/usage-monitor-for-claude-v<version>.zip
# Ships only the runtime files; fails if manifest.json references a file
# that is not packaged, or if any script has a syntax error.
set -euo pipefail
cd "$(dirname "$0")/.."

FILES=(manifest.json background.js popup.html popup.js options.html options.js
       sniffer-main.js sniffer-bridge.js icons)

VERSION=$(node -p "require('./manifest.json').version")

for f in *.js; do node --check "$f"; done

# Every file the manifest points at must be inside the package
node -e '
const m = require("./manifest.json"), out = new Set();
(function walk(v) {
  if (typeof v === "string") { if (/\.(js|html|png|json|css)$/.test(v)) out.add(v); }
  else if (v && typeof v === "object") Object.values(v).forEach(walk);
})(m);
console.log([...out].join("\n"));
' | while read -r ref; do
  ok=0
  for f in "${FILES[@]}"; do [[ "$ref" == "$f" || "$ref" == "$f"/* ]] && ok=1; done
  [[ $ok == 1 && -e "$ref" ]] || { echo "manifest references unpackaged/missing file: $ref" >&2; exit 1; }
done

mkdir -p dist
OUT="dist/usage-monitor-for-claude-v${VERSION}.zip"
rm -f "$OUT"
zip -q -r -X "$OUT" "${FILES[@]}"
echo "$OUT"
