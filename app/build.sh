#!/usr/bin/env bash
# Build Kosika for phones: the engine, the programs it runs, and the
# on-phone model library, all into app/engine/ and app/programs.json.
#
#   KOSIKA=../kosika DESIGNS=../kosika-designs app/build.sh
#
# KOSIKA and DESIGNS are checkouts of the kosika and kosika-designs repos
# (by default, next to this repo). Needs Go and npm. The website's Pages
# workflow runs this on every push, so nothing built is kept in git.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
KOSIKA="$(cd "${KOSIKA:-$here/../../kosika}" && pwd)"
DESIGNS="$(cd "${DESIGNS:-$here/../../kosika-designs}" && pwd)"
mkdir -p "$here/engine"

echo "1/5  the Kosika engine, as WebAssembly"
(cd "$KOSIKA/native" && GOOS=js GOARCH=wasm go build -trimpath -ldflags="-s -w" -o "$here/engine/kosika.wasm" .)
cp "$(go env GOROOT)/lib/wasm/wasm_exec.js" "$here/engine/wasm_exec.js" 2>/dev/null ||
  cp "$(go env GOROOT)/misc/wasm/wasm_exec.js" "$here/engine/wasm_exec.js"

echo "2/5  the model that runs on the phone (WebLLM)"
WEBLLM_VERSION=0.2.88
if [ ! -f "$here/engine/web-llm.js" ] || ! grep -q "$WEBLLM_VERSION" "$here/engine/web-llm.version" 2>/dev/null; then
  tmp="$(mktemp -d)"
  (cd "$tmp" && npm pack --silent "@mlc-ai/web-llm@$WEBLLM_VERSION" >/dev/null && tar xzf ./*.tgz)
  cp "$tmp/package/lib/index.js" "$here/engine/web-llm.js"
  echo "$WEBLLM_VERSION" > "$here/engine/web-llm.version"
  rm -rf "$tmp"
fi

echo "3/5  the programs: Kosi, the agents and the Explainer"
node - "$here" "$KOSIKA" "$DESIGNS" <<'EOF'
const fs = require("fs"), path = require("path");
const [here, kosika, designs] = process.argv.slice(2);
const kos = (dir) => Object.fromEntries(fs.readdirSync(dir).filter((f) => f.endsWith(".kos")).map((f) => [f, fs.readFileSync(path.join(dir, f), "utf8")]));
const agents = path.join(kosika, "examples/agents");
const programs = {
  kosi: { main: "kosi.kos", files: kos(path.join(here, "kosi")) },
  explain: { main: "explain.kos", files: { "explain.kos": fs.readFileSync(path.join(designs, "explain.kos"), "utf8") } },
};
for (const name of ["study", "coach", "notebook", "router"]) {
  programs[name] = { main: "main.kos", files: kos(path.join(agents, name)), memory: true };
}
// A program that declares no model is run without one: the engine refuses
// a model it was given but has no use for.
for (const p of Object.values(programs)) p.models = Object.values(p.files).some((t) => /^model\s|^import "std\/designs/m.test(t));
fs.writeFileSync(path.join(here, "programs.json"), JSON.stringify(programs));
console.log("     " + Object.keys(programs).join(", "));
EOF

echo "4/5  the app's look, made by Kosika Designs (look.kos)"
tmpbin="$(mktemp -d)"
(cd "$KOSIKA/native" && go build -o "$tmpbin/kosika-native" .)
echo '{"ask": {"seed": 137}}' > "$tmpbin/in.json"
"$tmpbin/kosika-native" run "$here/kosi/look.kos" --workflow look --input "$tmpbin/in.json" --json --trace "$tmpbin/trace.jsonl" > "$here/look.json"
node -e 'const l=require(process.argv[1]); if (l.problems.length) { console.error(l.problems.join("\n")); process.exit(1) } require("fs").writeFileSync(process.argv[2], "/* Made by Kosika Designs (app/kosi/look.kos): its palettes and the motion of its art. */\n" + l.css)' "$here/look.json" "$here/look.css"
rm -rf "$tmpbin"

echo "5/5  the build's name, so phones fetch the new one"
id="$(cat "$here/engine/kosika.wasm" "$here/programs.json" "$here/look.json" "$here"/*.js "$here"/*.html "$here"/*.css | sha256sum | cut -c1-12)"
echo "self.KOSIKA_BUILD = \"$id\";" > "$here/build-id.js"
ls -la "$here/engine" | sed 's/^/     /'
echo "built $id"
