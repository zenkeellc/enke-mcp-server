#!/bin/bash
set -euo pipefail

VERSION="${1:-1.0.0}"
REPO="enke-mcp-server"
GITHUB_REMOTE="origin"

echo "=== Releasing $REPO v$VERSION ==="

# 1. Check working directory clean
if [[ -n $(git status --porcelain) ]]; then
  echo "Error: working directory not clean. Commit or stash changes first."
  exit 1
fi

# 2. Update version
npm version "$VERSION" --no-git-tag-version --allow-same-version

# 3. Install & Build
npm install
npm run build

# 4. Publish to npm
echo "--- Publishing enke-mcp-server ---"
npm publish --access public 2>&1 || echo "Warning: npm publish may need auth. Run: npm login"

# 5. Git tag & push
git add package.json
git commit -m "release: v$VERSION"
git tag "v$VERSION"
git push "$GITHUB_REMOTE" main
git push "$GITHUB_REMOTE" "v$VERSION"

# 6. Create GitHub Release
if command -v gh &> /dev/null; then
  gh release create "v$VERSION" \
    --title "enke-mcp-server v$VERSION" \
    --notes "## enke MCP Server v$VERSION

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

### Changes
- Fixed SSE transport routing (sessionId URL matching)
- Transport pool with session tracking (multi-client support)
- SSE authentication on GET /sse
- Tool error handling with EnkeError sanitization
- Schema validation: expiresIn enum, label min(1), theme enum
- stdio console.log redirection to stderr" \
    --repo "zenkeellc/$REPO"
else
  echo "GitHub CLI (gh) not found. Create release manually at:"
  echo "  https://github.com/zenkeellc/$REPO/releases/new?tag=v$VERSION"
fi

echo "=== Release complete: v$VERSION ==="
