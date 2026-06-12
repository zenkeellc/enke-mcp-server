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
  shorten, listLinks, deleteLink, updateLink, getLinkStats,
  createLanding, getToken, EnkeError,
  uploadDoc, listDocs, getDoc, deleteDoc, updateDoc, renewDoc,
} from "enke-sdk";
import http from "node:http";

// ── Tool Schemas ──

const expiresInEnum = z.enum(["1h", "24h", "7d", "30d"]).optional();

const ShortenSchema = z.object({
  url: z.string().url().describe("The long URL to shorten"),
  slug: z.string().min(1).optional().describe("Custom short slug (back-half). Auto-generated if omitted."),
  password: z.string().min(1).optional().describe("Optional password to protect the link"),
  expiresIn: expiresInEnum.describe("Expiration duration: 1h, 24h, 7d, 30d"),
  webhookUrl: z.string().url().optional().describe("Webhook URL called when the link is clicked"),
});
type ShortenInput = z.infer<typeof ShortenSchema>;

const ListLinksSchema = z.object({
  limit: z.number().min(1).max(100).default(20).describe("Max number of links to return (default 20, max 100)"),
  search: z.string().optional().describe("Search term to filter links"),
});
type ListLinksInput = z.infer<typeof ListLinksSchema>;

const LinkIdSchema = z.object({
  id: z.string().describe("The slug or ID of the short link"),
});
type LinkIdInput = z.infer<typeof LinkIdSchema>;

const UpdateLinkSchema = z.object({
  id: z.string().describe("The slug or ID of the short link to update"),
  slug: z.string().min(1).optional().describe("New custom slug"),
  password: z.string().min(1).optional().describe("New password (set empty string to remove)"),
  expiresIn: expiresInEnum.describe("New expiration: 1h, 24h, 7d, 30d"),
  webhookUrl: z.string().url().optional().describe("New webhook URL"),
});
type UpdateLinkInput = z.infer<typeof UpdateLinkSchema>;

const CreateLandingSchema = z.object({
  title: z.string().min(1).describe("Title of the landing page"),
  links: z.array(z.object({
    url: z.string().url(),
    label: z.string().min(1),
  })).describe("Array of {url, label} pairs"),
  slug: z.string().min(1).optional().describe("Custom slug for the landing page"),
  theme: z.enum(["light", "dark", "minimal"]).optional().describe("Theme name (light, dark, minimal)"),
});
type CreateLandingInput = z.infer<typeof CreateLandingSchema>;

// ── Error wrapper ──

function wrapTool<T>(
  fn: (input: T) => Promise<{ content: Array<{ type: "text"; text: string }> }>,
) {
  return async (input: T): Promise<{ content: Array<{ type: "text"; text: string }> }> => {
    try {
      return await fn(input);
    } catch (err) {
      const msg = err instanceof EnkeError
        ? `en.ke API error: ${err.message}`
        : err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text" as const, text: `Error: ${msg}` }] };
    }
  };
}

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
  wrapTool(async (input: ShortenInput) => {
    const link = await shorten(input.url, {
      slug: input.slug,
      password: input.password,
      expiresIn: input.expiresIn,
      webhookUrl: input.webhookUrl,
    });
    return { content: [{ type: "text", text: JSON.stringify(link, null, 2) }] };
  }),
);

server.tool(
  "list_links",
  "List your short links. Returns up to 100 results; use limit and search to filter.",
  ListLinksSchema.shape,
  wrapTool(async (input: ListLinksInput) => {
    const links = await listLinks({ limit: input.limit, search: input.search });
    return { content: [{ type: "text", text: JSON.stringify(links, null, 2) }] };
  }),
);

server.tool(
  "get_link_stats",
  "Get click analytics for a specific short link: daily counts, referrers, geo distribution, and device types.",
  LinkIdSchema.shape,
  wrapTool(async (input: LinkIdInput) => {
    const stats = await getLinkStats(input.id);
    return { content: [{ type: "text", text: JSON.stringify(stats, null, 2) }] };
  }),
);

server.tool(
  "delete_link",
  "Permanently revoke and delete a short link. The link will stop redirecting immediately. This action is irreversible.",
  LinkIdSchema.shape,
  wrapTool(async (input: LinkIdInput) => {
    await deleteLink(input.id);
    return { content: [{ type: "text", text: `Link "${input.id}" has been deleted.` }] };
  }),
);

server.tool(
  "update_link",
  "Update a short link's properties: change slug, set/remove password, change expiration, or update webhook URL. The target URL cannot be changed.",
  UpdateLinkSchema.shape,
  wrapTool(async (input: UpdateLinkInput) => {
    const link = await updateLink(input.id, {
      slug: input.slug,
      password: input.password,
      expiresIn: input.expiresIn,
      webhookUrl: input.webhookUrl,
    });
    return { content: [{ type: "text", text: JSON.stringify(link, null, 2) }] };
  }),
);

server.tool(
  "create_landing",
  "Create a landing page with multiple links. Useful for sharing collections of links with a single URL.",
  CreateLandingSchema.shape,
  wrapTool(async (input: CreateLandingInput) => {
    const lp = await createLanding({
      title: input.title,
      links: input.links,
      slug: input.slug,
      theme: input.theme,
    });
    return { content: [{ type: "text", text: JSON.stringify(lp, null, 2) }] };
  }),
);

// ── Document Share Tools ──

const DocUploadSchema = z.object({
  file_path: z.string().describe("Absolute path to the file to upload"),
  exp_days: z.number().min(1).max(365).default(30).describe("Expiration in days"),
  password: z.string().min(4).optional().describe("Password to protect the document"),
  comment: z.string().optional().describe("Owner-facing note or label"),
  burn_after_reading: z.boolean().default(false).describe("Delete after first download"),
  disable_download: z.boolean().default(false).describe("Preview only, no download button"),
  max_downloads: z.number().min(0).default(0).describe("Max downloads (0 = unlimited)"),
});
type DocUploadInput = z.infer<typeof DocUploadSchema>;

server.tool(
  "upload_document",
  "Upload and share a file. Returns a short URL (https://en.ke/{slug}) for secure sharing with expiration, password, watermark, and burn-after-reading.",
  DocUploadSchema.shape,
  wrapTool(async (input: DocUploadInput) => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const filePath = path.resolve(input.file_path);
    if (!fs.existsSync(filePath)) {
      return { content: [{ type: "text" as const, text: `Error: File not found: ${filePath}` }] };
    }
    const filename = path.basename(filePath);
    const doc = await uploadDoc(filePath, filename, {
      exp_days: input.exp_days,
      password: input.password,
      comment: input.comment,
      burn_after_reading: input.burn_after_reading,
      disable_download: input.disable_download,
      max_downloads: input.max_downloads,
    });
    return { content: [{ type: "text" as const, text: `Uploaded: https://en.ke/${doc.slug}\n${JSON.stringify(doc, null, 2)}` }] };
  }),
);

const DocListSchema = z.object({
  cursor: z.string().optional().describe("Pagination cursor"),
  limit: z.number().min(1).max(100).default(20).describe("Items per page"),
});
type DocListInput = z.infer<typeof DocListSchema>;

server.tool(
  "list_documents",
  "List all shared documents, newest first.",
  DocListSchema.shape,
  wrapTool(async (input: DocListInput) => {
    const result = await listDocs(input.cursor, input.limit);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }),
);

const DocIdSchema = z.object({
  slug: z.string().describe("Document short slug"),
});
type DocIdInput = z.infer<typeof DocIdSchema>;

server.tool(
  "get_document",
  "Get details of a specific shared document by slug.",
  DocIdSchema.shape,
  wrapTool(async (input: DocIdInput) => {
    const doc = await getDoc(input.slug);
    return { content: [{ type: "text" as const, text: JSON.stringify(doc, null, 2) }] };
  }),
);

server.tool(
  "delete_document",
  "Permanently delete a shared document and its file. Irreversible.",
  DocIdSchema.shape,
  wrapTool(async (input: DocIdInput) => {
    await deleteDoc(input.slug);
    return { content: [{ type: "text" as const, text: `Document "${input.slug}" deleted.` }] };
  }),
);

const DocUpdateSchema = z.object({
  slug: z.string().describe("Document short slug"),
  exp_days: z.number().min(1).max(365).optional().describe("New expiration in days"),
  password: z.string().optional().describe("New password (empty to remove)"),
  comment: z.string().optional().describe("New comment"),
  burn_after_reading: z.boolean().optional(),
  disable_download: z.boolean().optional(),
  max_downloads: z.number().min(0).optional(),
});
type DocUpdateInput = z.infer<typeof DocUpdateSchema>;

server.tool(
  "update_document",
  "Update a shared document's settings: expiration, password, download limits, burn-after-reading.",
  DocUpdateSchema.shape,
  wrapTool(async (input: DocUpdateInput) => {
    const doc = await updateDoc(input.slug, {
      exp_days: input.exp_days,
      password: input.password,
      comment: input.comment,
      burn_after_reading: input.burn_after_reading,
      disable_download: input.disable_download,
      max_downloads: input.max_downloads,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(doc, null, 2) }] };
  }),
);

server.tool(
  "renew_document",
  "Reset a document's expiration timer to the plan's renewal period.",
  DocIdSchema.shape,
  wrapTool(async (input: DocIdInput) => {
    const doc = await renewDoc(input.slug);
    return { content: [{ type: "text" as const, text: `Renewed: ${doc.slug} (${doc.exp_days} days)` }] };
  }),
);

// ── Authentication ──

async function checkAuth(): Promise<boolean> {
  if (process.env.ENKE_API_KEY) return true;
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
  // Redirect console.log to stderr to avoid corrupting the JSON-RPC stream
  const originalLog = console.log;
  console.log = (...args: unknown[]) => console.error(...args);

  const authed = await checkAuth();
  if (!authed) {
    console.error("[enke-mcp-server] Not authenticated. Run 'enke login' first, or set ENKE_API_KEY.");
    process.exit(1);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Restore console.log (belt-and-suspenders)
  console.log = originalLog;
  console.error("[enke-mcp-server] Running in local (stdio) mode");
}

async function runSSE(): Promise<void> {
  const port = parseInt(process.env.ENKE_MCP_PORT ?? "3100", 10);
  // Pool of active SSE transports keyed by sessionId
  const transports = new Map<string, SSEServerTransport>();

  const httpServer = http.createServer(async (req, res) => {
    const reqUrl = req.url ?? "/";

    // Health check (no auth required)
    if (reqUrl === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }

    // SSE connection
    if (req.method === "GET" && reqUrl === "/sse") {
      // Auth required for SSE stream
      const authed = process.env.ENKE_API_KEY
        ? true
        : !!(req.headers.authorization?.startsWith("Bearer "));
      if (!authed) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Missing Authorization: Bearer <token> header" }));
        return;
      }

      const transport = new SSEServerTransport("/message", res);
      transports.set(transport.sessionId, transport);

      transport.onclose = () => {
        transports.delete(transport.sessionId);
      };

      await server.connect(transport);
      return;
    }

    // POST message dispatch (MCP client → server)
    if (req.method === "POST" && reqUrl.startsWith("/message")) {
      const url = new URL(reqUrl, "http://127.0.0.1");
      const sessionId = url.searchParams.get("sessionId");
      if (!sessionId) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Missing sessionId" }));
        return;
      }

      const transport = transports.get(sessionId);
      if (!transport) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unknown session" }));
        return;
      }

      let body = "";
      req.on("data", chunk => { body += chunk; });
      req.on("end", async () => {
        try {
          const msg = JSON.parse(body);
          await transport.handlePostMessage(req, res, msg);
        } catch {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid JSON" }));
        }
      });
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
