#!/usr/bin/env node

/**
 * en.ke MCP Server
 *
 * Exposes en.ke link management tools to AI agents via the Model Context Protocol.
 *
 * Transport modes:
 *   local (default):  stdio — for Claude Desktop, Cursor, etc.
 *   remote:           SSE   — set ENKE_MCP_TRANSPORT=sse ENKE_MCP_PORT=3100
 *
 * Configuration:
 *   npx enke-mcp-server                           # local, reads ~/.enke/config.json
 *   ENKE_API_KEY=xxx npx enke-mcp-server          # remote, API key auth
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";
import {
  shorten, listLinks, getLink, deleteLink, updateLink, getLinkStats,
  createLanding, whoami, EnkeError, loadConfig, getToken,
} from "@enke/sdk";
import http from "node:http";

// ── Tool Schemas ──

const ShortenSchema = z.object({
  url: z.string().url().describe("The long URL to shorten"),
  slug: z.string().optional().describe("Custom short slug (back-half). Auto-generated if omitted."),
  password: z.string().optional().describe("Optional password to protect the link"),
  expiresIn: z.string().optional().describe("Expiration duration: 1h, 24h, 7d, 30d"),
  webhookUrl: z.string().url().optional().describe("Webhook URL called when the link is clicked"),
});
type ShortenInput = z.infer<typeof ShortenSchema>;

const ListLinksSchema = z.object({
  limit: z.number().min(1).max(100).default(20).describe("Max number of links to return"),
  search: z.string().optional().describe("Search term to filter links"),
});
type ListLinksInput = z.infer<typeof ListLinksSchema>;

const LinkIdSchema = z.object({
  id: z.string().describe("The slug or ID of the short link"),
});
type LinkIdInput = z.infer<typeof LinkIdSchema>;

const UpdateLinkSchema = z.object({
  id: z.string().describe("The slug or ID of the short link to update"),
  slug: z.string().optional().describe("New custom slug"),
  password: z.string().optional().describe("New password (set empty to remove)"),
  expiresIn: z.string().optional().describe("New expiration: 1h, 24h, 7d, 30d"),
  webhookUrl: z.string().url().optional().describe("New webhook URL"),
});
type UpdateLinkInput = z.infer<typeof UpdateLinkSchema>;

const CreateLandingSchema = z.object({
  title: z.string().describe("Title of the landing page"),
  links: z.array(z.object({
    url: z.string().url(),
    label: z.string(),
  })).describe("Array of {url, label} pairs"),
  slug: z.string().optional().describe("Custom slug for the landing page"),
  theme: z.string().optional().describe("Theme name (light, dark, minimal)"),
});
type CreateLandingInput = z.infer<typeof CreateLandingSchema>;

// ── Server Setup ──

const server = new McpServer({
  name: "enke-mcp-server",
  version: "0.1.0",
  description: "en.ke — secure link & context relay for AI agents. Create, manage, and audit short links.",
});

// ── Tools ──

server.tool(
  "shorten_url",
  "Create a short link from a long URL. Use this to share links, pass context between agents, or create temporary revocable references.",
  ShortenSchema.shape,
  async (input: ShortenInput) => {
    const link = await shorten(input.url, {
      slug: input.slug,
      password: input.password,
      expiresIn: input.expiresIn,
      webhookUrl: input.webhookUrl,
    });
    return {
      content: [{ type: "text", text: JSON.stringify(link, null, 2) }],
    };
  },
);

server.tool(
  "list_links",
  "List all your short links.",
  ListLinksSchema.shape,
  async (input: ListLinksInput) => {
    const links = await listLinks({ limit: input.limit, search: input.search });
    return {
      content: [{ type: "text", text: JSON.stringify(links, null, 2) }],
    };
  },
);

server.tool(
  "get_link_stats",
  "Get click analytics for a specific short link, including daily counts, referrers, geo distribution, and device types.",
  LinkIdSchema.shape,
  async (input: LinkIdInput) => {
    const stats = await getLinkStats(input.id);
    return {
      content: [{ type: "text", text: JSON.stringify(stats, null, 2) }],
    };
  },
);

server.tool(
  "delete_link",
  "Revoke and delete a short link. The link will no longer redirect.",
  LinkIdSchema.shape,
  async (input: LinkIdInput) => {
    await deleteLink(input.id);
    return {
      content: [{ type: "text", text: `Link "${input.id}" has been deleted.` }],
    };
  },
);

server.tool(
  "update_link",
  "Update a short link's properties: change slug, set/remove password, change expiration, or update webhook URL.",
  UpdateLinkSchema.shape,
  async (input: UpdateLinkInput) => {
    const link = await updateLink(input.id, {
      slug: input.slug,
      password: input.password,
      expiresIn: input.expiresIn,
      webhookUrl: input.webhookUrl,
    });
    return {
      content: [{ type: "text", text: JSON.stringify(link, null, 2) }],
    };
  },
);

server.tool(
  "create_landing",
  "Create a landing page with multiple links. Useful for sharing collections of links.",
  CreateLandingSchema.shape,
  async (input: CreateLandingInput) => {
    const lp = await createLanding({
      title: input.title,
      links: input.links,
      slug: input.slug,
      theme: input.theme,
    });
    return {
      content: [{ type: "text", text: JSON.stringify(lp, null, 2) }],
    };
  },
);

// ── Authentication check ──

async function checkAuth(): Promise<boolean> {
  // API Key mode (for remote deployments)
  if (process.env.ENKE_API_KEY) return true;

  // Local config mode (for desktop clients)
  try {
    const token = await getToken();
    return token !== null;
  } catch {
    return false;
  }
}

// ── Transport Selection ──

const TRANSPORT = process.env.ENKE_MCP_TRANSPORT ?? "stdio";

async function runStdio(): Promise<void> {
  const authed = await checkAuth();
  if (!authed) {
    console.error("[enke-mcp-server] Not authenticated. Run 'enke login' first, or set ENKE_API_KEY.");
    process.exit(1);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[enke-mcp-server] Running in local (stdio) mode");
}

async function runSSE(): Promise<void> {
  const port = parseInt(process.env.ENKE_MCP_PORT ?? "3100", 10);

  const httpServer = http.createServer(async (req, res) => {
    // Auth check: API Key from env or Authorization header
    const authHeader = req.headers.authorization;
    const apiKey = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    const hasAuth = !!(apiKey || process.env.ENKE_API_KEY);
    if (!hasAuth) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing Authorization: Bearer <token> header" }));
      return;
    }

    // Handle POST messages (MCP client → server)
    if (req.method === "POST" && req.url === "/message") {
      let body = "";
      req.on("data", chunk => { body += chunk; });
      req.on("end", async () => {
        try {
          const msg = JSON.parse(body);
          // For SSE mode, we handle messages directly via the server
          res.writeHead(202);
          res.end();
          // TODO: process message through server.handleMessage
        } catch {
          res.writeHead(400);
          res.end(JSON.stringify({ error: "Invalid JSON" }));
        }
      });
      return;
    }

    // Health check
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }

    // SSE connection
    if (req.method === "GET" && req.url === "/sse") {
      const transport = new SSEServerTransport("/message", res);
      await server.connect(transport);
      return;
    }

    res.writeHead(404);
    res.end("Not found");
  });

  httpServer.listen(port, () => {
    console.error(`[enke-mcp-server] Running in remote (SSE) mode on port ${port}`);
    console.error(`[enke-mcp-server] SSE endpoint:  http://localhost:${port}/sse`);
    console.error(`[enke-mcp-server] Health check:   http://localhost:${port}/health`);
  });
}

// ── Main ──

if (TRANSPORT === "sse") {
  runSSE().catch(err => {
    console.error("[enke-mcp-server] SSE failed:", err);
    process.exit(1);
  });
} else {
  runStdio().catch(err => {
    console.error("[enke-mcp-server] Stdio failed:", err);
    process.exit(1);
  });
}
