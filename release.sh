#!/bin/bash
set -euo pipefail

VERSION="${1:-}"
REPO="enke-mcp-server"
GITHUB_REMOTE="origin"

if [[ -z "$VERSION" ]]; then
  echo "Usage: $0 <version>"
  echo "Example: $0 1.2.1"
  exit 1
fi

echo "=== Releasing $REPO v$VERSION ==="

# ── 1. Pre-flight checks ──

if [[ -n $(git status --porcelain) ]]; then
  echo "Error: working directory not clean. Commit or stash changes first."
  git status --short
  exit 1
fi

BRANCH=$(git branch --show-current)
if [[ "$BRANCH" != "main" ]]; then
  echo "Error: not on main branch (currently: $BRANCH). Switch to main first."
  exit 1
fi

# ── 2. Run tests ──

echo "--- Running tests ---"
npx vitest run --reporter=verbose 2>&1 || {
  echo "Error: tests failed. Fix before releasing."
  exit 1
}

# ── 3. Type-check ──

echo "--- Type-checking ---"
npm run type-check 2>&1 || { echo "Error: type-check failed"; exit 1; }

# ── 4. Bump version & update enke-sdk dep ──

echo "--- Bumping version to $VERSION ---"
npm version "$VERSION" --no-git-tag-version 2>&1

# Update enke-sdk dependency to match (use caret range)
SDK_DEP="^$VERSION"
# Read current enke-sdk dep line
if grep -q '"enke-sdk":' package.json; then
  # Use node to update the dep safely
  node -e "
    const fs = require('fs');
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
    pkg.dependencies['enke-sdk'] = '$SDK_DEP';
    fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
  "
  echo "  Updated enke-sdk dependency to $SDK_DEP"
fi

# ── 5. Install & Build ──

echo "--- Installing dependencies ---"
npm install 2>&1 || { echo "Error: npm install failed"; exit 1; }

echo "--- Building ---"
npm run build 2>&1 || { echo "Error: build failed"; exit 1; }

# ── 6. Publish to npm ──

echo "--- Publishing enke-mcp-server@$VERSION ---"
npm publish --access public 2>&1 || {
  echo "Error: npm publish failed."
  exit 1
}

# ── 7. Verify published package ──

echo "--- Verifying npm package ---"
PUBLISHED=$(npm view enke-mcp-server version 2>/dev/null)
if [[ "$PUBLISHED" != "$VERSION" ]]; then
  echo "Warning: enke-mcp-server@$PUBLISHED on npm (expected $VERSION). CDN may be propagating."
else
  echo "  enke-mcp-server@$PUBLISHED ✓"
fi

# ── 8. Git tag & push ──

echo "--- Committing and tagging ---"
git add package.json package-lock.json
git commit -m "release: v$VERSION"

git tag "v$VERSION"
git push "$GITHUB_REMOTE" main
git push "$GITHUB_REMOTE" "v$VERSION"

# ── 9. Create GitHub Release ──

if command -v gh &> /dev/null; then
  echo "--- Creating GitHub Release ---"

  NOTES=$(cat <<EOF
## enke MCP Server v$VERSION

### Install
\`\`\`bash
npm install -g enke-mcp-server
# or run directly:
npx -y enke-mcp-server
\`\`\`

### 12 MCP Tools
| # | Tool | Description |
|---|------|-------------|
| 1 | \`shorten_url\` | Create a short link |
| 2 | \`list_links\` | List short links |
| 3 | \`get_link_stats\` | Click analytics |
| 4 | \`delete_link\` | Revoke a link |
| 5 | \`update_link\` | Modify link properties |
| 6 | \`create_landing\` | Create landing page |
| 7 | \`upload_document\` | Upload & share a file |
| 8 | \`list_documents\` | List documents |
| 9 | \`get_document\` | Get document details |
| 10 | \`delete_document\` | Delete a document |
| 11 | \`update_document\` | Update document settings |
| 12 | \`renew_document\` | Reset document expiration |

### Transport Modes
- **Local (stdio):** Claude Desktop, Cursor — \`npx -y enke-mcp-server\`
- **Remote (SSE):** \`ENKE_API_KEY=xxx ENKE_MCP_TRANSPORT=sse npx enke-mcp-server\`

### Recent Changes
$(git log --oneline $(git describe --tags --abbrev=0 2>/dev/null || echo "HEAD~10")..HEAD~1 2>/dev/null | sed 's/^/- /' || echo "- Initial release")
EOF
)

  gh release create "v$VERSION" \
    --title "enke-mcp-server v$VERSION" \
    --notes "$NOTES" \
    --repo "zenkeellc/$REPO"
  echo "  Release: https://github.com/zenkeellc/$REPO/releases/tag/v$VERSION"
else
  echo "GitHub CLI (gh) not found. Create release manually at:"
  echo "  https://github.com/zenkeellc/$REPO/releases/new?tag=v$VERSION"
fi

echo "=== Release complete: $REPO v$VERSION ==="
