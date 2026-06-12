# enke-mcp-server

MCP (Model Context Protocol) server — exposes en.ke link management as 12 tools for AI agents.

## Project Structure

```
src/
  server.ts          — Main entry: tool definitions, transport selection, SSE server
  __tests__/
    server.test.ts   — MCP protocol tests (initialize, tools/list, tools/call)
package.json
release.sh
```

## Tech Stack
- TypeScript, Node.js ESM
- `@modelcontextprotocol/sdk` — MCP server framework
- `zod` — tool schema validation
- `enke-sdk` — shared auth, API client, types (npm dependency)
- Vitest for testing
- Deployed as npm package: `enke-mcp-server`

## Build & Test

```bash
# Install
npm install

# Type-check
npm run type-check    # tsc --noEmit

# Build
npm run build         # tsc

# Test
npx vitest run
```

## Architecture

### Transport Modes
- **stdio** (default): For Claude Desktop, Cursor. Connects via stdin/stdout JSON-RPC.
- **SSE**: Set `ENKE_MCP_TRANSPORT=sse ENKE_MCP_PORT=3100`. HTTP server with Server-Sent Events.

### Auth
- Checks `ENKE_API_KEY` env var first — if set, auth is bypassed (remote mode)
- Otherwise reads `~/.config/enke/config.json` (same as CLI — populated by `enke login`)

### 12 MCP Tools

| # | Tool | SDK function | API endpoint |
|---|------|-------------|--------------|
| 1 | `shorten_url` | `shorten(url, opts)` | `POST /api/v1/links` |
| 2 | `list_links` | `listLinks({uid, cursor})` | `GET /api/v1/links?uid=&cursor=` |
| 3 | `get_link_stats` | `getLinkStats(slug, uid)` | `GET /api/v1/link_stat/:slug` |
| 4 | `delete_link` | `deleteLink(slug)` | `DELETE /api/v1/links/:slug` |
| 5 | `update_link` | `updateLink(slug, opts)` | `PUT /api/v1/links/:slug` |
| 6 | `create_landing` | `createLanding(opts)` | `POST /api/v1/landing` |
| 7 | `upload_document` | `uploadDoc(path, name, opts)` | `POST /api/v1/docs` |
| 8 | `list_documents` | `listDocs(cursor, limit)` | `GET /api/v1/docs` |
| 9 | `get_document` | `getDoc(slug)` | `GET /api/v1/docs/:slug` |
| 10 | `delete_document` | `deleteDoc(slug)` | `DELETE /api/v1/docs/:slug` |
| 11 | `update_document` | `updateDoc(slug, opts)` | `PUT /api/v1/docs/:slug` |
| 12 | `renew_document` | `renewDoc(slug)` | `POST /api/v1/docs/:slug/renew` |

### Key design decisions
- Version is read from `package.json` via `createRequire` (not hardcoded)
- `console.log` is redirected to `console.error` in stdio mode to avoid corrupting JSON-RPC
- `wrapTool()` catches all errors and formats them as MCP content responses (never throws)
- UID is cached from `whoami()` call on first use to avoid redundant API requests

## Release Process

### Quick: single tool
```bash
./release.sh <version>
```

### Detailed steps

1. **Pre-flight**: working directory clean, on `main` branch
2. **Tests**: `npx vitest run`
3. **Type-check**: `npm run type-check`
4. **Bump version**: `npm version <version> --no-git-tag-version`
5. **Update enke-sdk dep**: Set `dependencies.enke-sdk` to `^<version>` in package.json
6. **Install**: `npm install` (updates lockfile with new enke-sdk version)
7. **Build**: `npm run build`
8. **Publish**: `npm publish --access public`
9. **Verify**: `npm view enke-mcp-server version`
10. **Git**: commit package.json + lockfile, tag `v<version>`, push
11. **GitHub Release**: `gh release create v<version>` on `zenkeellc/enke-mcp-server`

### Dependencies
- `enke-sdk: ^<version>` — must be published BEFORE this package
- The release script updates this dependency automatically

### Error handling
| Failure | Action |
|---------|--------|
| Tests fail | Fix before releasing |
| Build fails | Fix build, retry |
| npm publish fails | Check auth (`npm whoami`), retry |
| Git push fails | Fix network/credentials; npm packages are already live |
| GitHub release fails | Create manually or ignore |

### Master orchestrator
From the parent tools directory:
```bash
./release-all.sh <version>
```
This publishes `enke-sdk` first, then `enke-cli`, then `enke-mcp-server` — in dependency order.
