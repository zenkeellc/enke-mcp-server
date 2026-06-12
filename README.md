# enke MCP Server

**Model Context Protocol server for en.ke — secure link tools for AI agents.**

Exposes en.ke link management as MCP tools. Two transport modes: local stdio (Claude Desktop, Cursor) and remote SSE (HTTP).

## Quick Start

### Local (Claude Desktop)

```json
{
  "mcpServers": {
    "enke": {
      "command": "npx",
      "args": ["-y", "enke-mcp-server"]
    }
  }
}
```

Requires `enke login` first (shared auth with enke CLI).

### Remote (SSE)

```bash
ENKE_API_KEY=xxx npx enke-mcp-server
# SSE endpoint: http://localhost:3100/sse
```

## Tools

| Tool | Description |
|------|-------------|
| `shorten_url` | Create a short link from a URL |
| `list_links` | List all short links |
| `get_link_stats` | Click analytics (daily, referrers, geo, devices) |
| `delete_link` | Revoke a short link |
| `update_link` | Modify slug, password, expiration, webhook |
| `create_landing` | Create a landing page with multiple links |

## Auth

- **Local mode:** Reads `~/.enke/config.json` (created by `enke login`)
- **Remote mode:** `ENKE_API_KEY` env var or `Authorization: Bearer <token>` header

## License

MIT
