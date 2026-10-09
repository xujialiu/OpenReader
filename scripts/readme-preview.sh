#!/usr/bin/env bash
# Builds .docs/README.html from README.md with GitHub's own Markdown renderer,
# styled as GitHub styles it, and opens it, so the owner sees the front page
# before it is committed (MEMORY/documentation.md, "README.md").
#
#   bash scripts/readme-preview.sh            # build and open
#   bash scripts/readme-preview.sh --no-open  # build only
#
# Needs the network and a signed-in `gh`. .docs/ is ignored by git.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
out_dir="$root/.docs"
out="$out_dir/README.html"
mkdir -p "$out_dir"

# The same renderer the repository page uses; relative links stay relative.
body="$(gh api -X POST /markdown -f mode=gfm -f context=xujialiu/OpenReader -F text=@"$root/README.md")"

{
  cat <<'HTML'
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<base href="../">
<title>README.md preview</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/github-markdown-css/5.8.1/github-markdown.min.css">
<style>
  body { box-sizing: border-box; max-width: 880px; margin: 0 auto; padding: 32px 24px; }
  @media (prefers-color-scheme: dark) { body { background: #0d1117; } }
</style>
</head>
<body>
<article class="markdown-body">
HTML
  printf '%s\n' "$body"
  cat <<'HTML'
</article>
</body>
</html>
HTML
} > "$out"

echo "$out"
if [[ "${1:-}" != "--no-open" ]]; then open "$out"; fi
