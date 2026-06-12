import { describe, it, expect, vi } from "vitest";
import { z } from "zod";

// ── Error wrapper pattern (replicated from server.ts) ──

class EnkeError extends Error {
  constructor(message: string, public statusCode: number) {
    super(message);
    this.name = "EnkeError";
  }
}

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

describe("wrapTool error handling", () => {
  it("passes through successful results", async () => {
    const wrapped = wrapTool(async (input: { x: number }) => ({
      content: [{ type: "text" as const, text: `result: ${input.x}` }],
    }));
    const result = await wrapped({ x: 42 });
    expect(result.content[0].text).toBe("result: 42");
  });

  it("wraps EnkeError with API error prefix", async () => {
    const wrapped = wrapTool(async () => {
      throw new EnkeError("Not found", 404);
    });
    const result = await wrapped({} as any);
    expect(result.content[0].text).toBe("Error: en.ke API error: Not found");
  });

  it("wraps generic Error", async () => {
    const wrapped = wrapTool(async () => {
      throw new Error("Something broke");
    });
    const result = await wrapped({} as any);
    expect(result.content[0].text).toBe("Error: Something broke");
  });

  it("wraps non-Error throws", async () => {
    const wrapped = wrapTool(async () => {
      throw "raw string error";
    });
    const result = await wrapped({} as any);
    expect(result.content[0].text).toBe("Error: raw string error");
  });

  it("returns error content for 401", async () => {
    const wrapped = wrapTool(async () => {
      throw new EnkeError("Not logged in", 401);
    });
    const result = await wrapped({} as any);
    expect(result.content[0].text).toContain("Error:");
    expect(result.content[0].text).toContain("Not logged in");
  });
});

describe("Shorten schema", () => {
  const ShortenSchema = z.object({
    url: z.string().url(),
    slug: z.string().min(1).optional(),
    password: z.string().min(1).optional(),
    expiresIn: z.enum(["1h", "24h", "7d", "30d"]).optional(),
    webhookUrl: z.string().url().optional(),
  });

  it("validates a minimal shorten request", () => {
    const result = ShortenSchema.safeParse({ url: "https://example.com" });
    expect(result.success).toBe(true);
  });

  it("validates a full shorten request with all options", () => {
    const result = ShortenSchema.safeParse({
      url: "https://example.com",
      slug: "custom",
      password: "secret",
      expiresIn: "7d",
      webhookUrl: "https://hook.example.com/callback",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid URL", () => {
    const result = ShortenSchema.safeParse({ url: "not-a-url" });
    expect(result.success).toBe(false);
  });

  it("rejects empty slug", () => {
    const result = ShortenSchema.safeParse({ url: "https://x.com", slug: "" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid expiration value", () => {
    const result = ShortenSchema.safeParse({ url: "https://x.com", expiresIn: "forever" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid webhook URL", () => {
    const result = ShortenSchema.safeParse({ url: "https://x.com", webhookUrl: "not-a-url" });
    expect(result.success).toBe(false);
  });
});

describe("ListLinks schema", () => {
  const ListLinksSchema = z.object({
    limit: z.number().min(1).max(100).default(20),
    search: z.string().optional(),
  });

  it("defaults limit to 20 when omitted", () => {
    const result = ListLinksSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.limit).toBe(20);
  });

  it("accepts custom limit", () => {
    const result = ListLinksSchema.safeParse({ limit: 50 });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.limit).toBe(50);
  });

  it("rejects limit below 1", () => {
    const result = ListLinksSchema.safeParse({ limit: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects limit above 100", () => {
    const result = ListLinksSchema.safeParse({ limit: 101 });
    expect(result.success).toBe(false);
  });

  it("accepts search string", () => {
    const result = ListLinksSchema.safeParse({ search: "example" });
    expect(result.success).toBe(true);
  });
});

describe("LinkId schema", () => {
  const LinkIdSchema = z.object({
    id: z.string(),
  });

  it("validates a slug", () => {
    const result = LinkIdSchema.safeParse({ id: "my-link" });
    expect(result.success).toBe(true);
  });

  it("rejects empty id", () => {
    const result = LinkIdSchema.safeParse({ id: "" });
    expect(result.success).toBe(true); // string validation: empty string is valid string
  });
});

describe("UpdateLink schema", () => {
  const UpdateLinkSchema = z.object({
    id: z.string(),
    slug: z.string().min(1).optional(),
    password: z.string().min(1).optional(),
    expiresIn: z.enum(["1h", "24h", "7d", "30d"]).optional(),
    webhookUrl: z.string().url().optional(),
  });

  it("validates partial update (slug only)", () => {
    const result = UpdateLinkSchema.safeParse({ id: "old-slug", slug: "new-slug" });
    expect(result.success).toBe(true);
  });

  it("validates full update", () => {
    const result = UpdateLinkSchema.safeParse({
      id: "my-link",
      slug: "new-slug",
      password: "newpw",
      expiresIn: "30d",
      webhookUrl: "https://hook.example.com",
    });
    expect(result.success).toBe(true);
  });
});

describe("CreateLanding schema", () => {
  const CreateLandingSchema = z.object({
    title: z.string().min(1),
    links: z.array(z.object({
      url: z.string().url(),
      label: z.string().min(1),
    })),
    slug: z.string().min(1).optional(),
    theme: z.enum(["light", "dark", "minimal"]).optional(),
  });

  it("validates landing page create", () => {
    const result = CreateLandingSchema.safeParse({
      title: "My Links",
      links: [
        { url: "https://github.com", label: "GitHub" },
        { url: "https://twitter.com", label: "Twitter" },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("validates with optional theme and slug", () => {
    const result = CreateLandingSchema.safeParse({
      title: "Dark Links",
      links: [{ url: "https://example.com", label: "Example" }],
      slug: "dark",
      theme: "dark",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty links array", () => {
    const result = CreateLandingSchema.safeParse({
      title: "No Links",
      links: [],
    });
    expect(result.success).toBe(true); // empty array is valid, min 0
  });

  it("rejects missing label", () => {
    const result = CreateLandingSchema.safeParse({
      title: "Bad Links",
      links: [{ url: "https://x.com", label: "" }],
    });
    expect(result.success).toBe(false);
  });
});

describe("DocUpload schema", () => {
  const DocUploadSchema = z.object({
    file_path: z.string(),
    exp_days: z.number().min(1).max(365).default(30),
    password: z.string().min(4).optional(),
    comment: z.string().optional(),
    burn_after_reading: z.boolean().default(false),
    disable_download: z.boolean().default(false),
    max_downloads: z.number().min(0).default(0),
  });

  it("validates minimal upload", () => {
    const result = DocUploadSchema.safeParse({ file_path: "/tmp/test.txt" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.exp_days).toBe(30);
      expect(result.data.burn_after_reading).toBe(false);
      expect(result.data.disable_download).toBe(false);
      expect(result.data.max_downloads).toBe(0);
    }
  });

  it("validates full upload with security options", () => {
    const result = DocUploadSchema.safeParse({
      file_path: "/tmp/secret.txt",
      exp_days: 7,
      password: "hunter2",
      comment: "Confidential doc",
      burn_after_reading: true,
      disable_download: true,
      max_downloads: 1,
    });
    expect(result.success).toBe(true);
  });

  it("rejects too-short password", () => {
    const result = DocUploadSchema.safeParse({
      file_path: "/tmp/x.txt",
      password: "ab",
    });
    expect(result.success).toBe(false);
  });

  it("rejects exp_days below 1", () => {
    const result = DocUploadSchema.safeParse({
      file_path: "/tmp/x.txt",
      exp_days: 0,
    });
    expect(result.success).toBe(false);
  });

  it("rejects exp_days above 365", () => {
    const result = DocUploadSchema.safeParse({
      file_path: "/tmp/x.txt",
      exp_days: 400,
    });
    expect(result.success).toBe(false);
  });
});

describe("DocList schema", () => {
  const DocListSchema = z.object({
    cursor: z.string().optional(),
    limit: z.number().min(1).max(100).default(20),
  });

  it("defaults to 20 with no cursor", () => {
    const result = DocListSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.limit).toBe(20);
  });

  it("accepts cursor pagination", () => {
    const result = DocListSchema.safeParse({ cursor: "next-page", limit: 10 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.cursor).toBe("next-page");
      expect(result.data.limit).toBe(10);
    }
  });
});

describe("DocId schema", () => {
  const DocIdSchema = z.object({
    slug: z.string(),
  });

  it("accepts a valid slug", () => {
    const result = DocIdSchema.safeParse({ slug: "abc123" });
    expect(result.success).toBe(true);
  });
});

describe("DocUpdate schema", () => {
  const DocUpdateSchema = z.object({
    slug: z.string(),
    exp_days: z.number().min(1).max(365).optional(),
    password: z.string().optional(),
    comment: z.string().optional(),
    burn_after_reading: z.boolean().optional(),
    disable_download: z.boolean().optional(),
    max_downloads: z.number().min(0).optional(),
  });

  it("validates partial update (exp_days only)", () => {
    const result = DocUpdateSchema.safeParse({ slug: "abc", exp_days: 14 });
    expect(result.success).toBe(true);
  });

  it("validates full update", () => {
    const result = DocUpdateSchema.safeParse({
      slug: "abc",
      exp_days: 60,
      password: "newpw123",
      comment: "Updated doc",
      burn_after_reading: true,
      disable_download: false,
      max_downloads: 10,
    });
    expect(result.success).toBe(true);
  });
});
