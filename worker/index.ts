import { Hono, type Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { streamSSE } from "hono/streaming";
import { isUuid, makeSlug, slugify } from "../shared/html";
import { titleFromIdea } from "../shared/text";
import {
  acquireLock,
  createProject,
  currentHtml,
  deleteProject,
  getProject,
  getPublished,
  getVersion,
  insertMessage,
  listMessages,
  listProjects,
  listVersions,
  publishProject,
  remixProject,
  restoreVersion,
  setStatus,
  toProject,
  unpublishProject,
  versionCount,
} from "./db";
import type { Env } from "./env";
import { mockEnabled, modelName } from "./env";
import { runPipeline } from "./pipeline";
import { ensureSchema } from "./schema";

type AppEnv = {
  Bindings: Env;
  Variables: { ownerId: string };
};

const app = new Hono<AppEnv>();

app.onError((error, c) => {
  console.error(JSON.stringify({ event: "worker_error", message: error.message }));
  return c.json({ error: "Something went wrong." }, 500);
});

app.get("/api/health", (c) => {
  return c.json({
    ok: true,
    mock: mockEnabled(c.env),
    model: modelName(c.env),
    hasKey: Boolean(c.env.OPENAI_API_KEY?.trim()),
  });
});

app.get("/p/:slug", async (c) => {
  await ensureSchema(c.env.DB);
  const slug = c.req.param("slug");
  const published = await getPublished(c.env.DB, slug);
  if (!published) {
    return c.html(unpublishedPage(), 404);
  }
  return c.html(published.html, 200, {
    "cache-control": "no-cache",
    "x-atoms-demo": "published",
    "x-content-type-options": "nosniff",
  });
});

app.use("/api/*", async (c, next) => {
  if (c.req.path === "/api/health") {
    await next();
    return;
  }
  await ensureSchema(c.env.DB);
  const ownerId = resolveOwner(c);
  c.set("ownerId", ownerId);
  const secure = new URL(c.req.url).protocol === "https:";
  setCookie(c, "atoms_uid", ownerId, {
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    maxAge: 60 * 60 * 24 * 365,
    secure,
  });
  await next();
});

app.get("/api/me", (c) => c.json({ ownerId: c.get("ownerId") }));

app.get("/api/projects", async (c) => {
  const projects = await listProjects(c.env.DB, c.get("ownerId"));
  return c.json({ projects });
});

app.post("/api/projects", async (c) => {
  const body = await readJson(c);
  const idea = typeof body.idea === "string" ? body.idea.trim() : "";
  if (idea.length < 1 || idea.length > 4000) {
    return c.json({ error: "Describe the product in 1 to 4000 characters." }, 400);
  }
  const now = Date.now();
  const id = crypto.randomUUID();
  await createProject(c.env.DB, {
    id,
    ownerId: c.get("ownerId"),
    title: titleFromIdea(idea).slice(0, 80),
    idea,
    messageId: crypto.randomUUID(),
    now,
  });
  const row = await getProject(c.env.DB, id, c.get("ownerId"));
  if (!row) return c.json({ error: "Could not create the project." }, 500);
  return c.json({ project: toProject(row) }, 201);
});

app.get("/api/projects/:id", async (c) => {
  const row = await getProject(c.env.DB, c.req.param("id"), c.get("ownerId"));
  if (!row) return c.json({ error: "Project not found" }, 404);
  const [messages, versions, html] = await Promise.all([
    listMessages(c.env.DB, row.id),
    listVersions(c.env.DB, row.id),
    currentHtml(c.env.DB, row.current_version_id),
  ]);
  return c.json({ project: toProject(row), messages, versions, html });
});

app.delete("/api/projects/:id", async (c) => {
  const ok = await deleteProject(c.env.DB, c.req.param("id"), c.get("ownerId"));
  if (!ok) return c.json({ error: "Project not found" }, 404);
  return c.json({ ok: true });
});

app.get("/api/projects/:id/versions/:versionId", async (c) => {
  const row = await getProject(c.env.DB, c.req.param("id"), c.get("ownerId"));
  if (!row) return c.json({ error: "Project not found" }, 404);
  const version = await getVersion(c.env.DB, row.id, c.req.param("versionId"));
  if (!version) return c.json({ error: "Version not found" }, 404);
  return c.json({ version });
});

app.get("/api/projects/:id/download", async (c) => {
  const row = await getProject(c.env.DB, c.req.param("id"), c.get("ownerId"));
  if (!row) return c.json({ error: "Project not found" }, 404);
  const versionId = c.req.query("version") || row.current_version_id;
  if (!versionId) return c.json({ error: "Nothing to download yet." }, 400);
  const version = await getVersion(c.env.DB, row.id, versionId);
  if (!version) return c.json({ error: "Version not found" }, 404);
  const filename = `${slugify(row.title)}-v${version.number}.html`;
  return c.body(version.html, 200, {
    "content-type": "text/html; charset=utf-8",
    "content-disposition": `attachment; filename="${filename}"`,
  });
});

app.post("/api/projects/:id/publish", async (c) => {
  const row = await getProject(c.env.DB, c.req.param("id"), c.get("ownerId"));
  if (!row) return c.json({ error: "Project not found" }, 404);
  if (!row.current_version_id) return c.json({ error: "Build a version before publishing." }, 400);
  let published: { slug: string; versionId: string } | null = null;
  for (let attempt = 0; attempt < 3 && !published; attempt += 1) {
    try {
      published = await publishProject(c.env.DB, row.id, c.get("ownerId"), makeSlug(), Date.now());
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (!/unique/i.test(message) || row.published_slug) throw error;
    }
  }
  if (!published) return c.json({ error: "Could not publish this project." }, 500);
  const url = new URL(`/p/${published.slug}`, c.req.url).toString();
  return c.json({ slug: published.slug, url, versionId: published.versionId });
});

app.post("/api/projects/:id/unpublish", async (c) => {
  const ok = await unpublishProject(c.env.DB, c.req.param("id"), c.get("ownerId"), Date.now());
  if (!ok) return c.json({ error: "Project not found" }, 404);
  return c.json({ ok: true });
});

app.post("/api/projects/:id/remix", async (c) => {
  const project = await remixProject(c.env.DB, c.req.param("id"), c.get("ownerId"));
  if (!project) return c.json({ error: "Project not found" }, 404);
  return c.json({ project }, 201);
});

app.post("/api/projects/:id/restore", async (c) => {
  const body = await readJson(c);
  const versionId = typeof body.versionId === "string" ? body.versionId : "";
  if (!isUuid(versionId)) return c.json({ error: "Choose a version to restore." }, 400);
  const restored = await restoreVersion(c.env.DB, {
    projectId: c.req.param("id"),
    ownerId: c.get("ownerId"),
    versionId,
    messageId: crypto.randomUUID(),
    now: Date.now(),
  });
  if (!restored) return c.json({ error: "Version not found" }, 404);
  const row = await getProject(c.env.DB, c.req.param("id"), c.get("ownerId"));
  return c.json({ project: row ? toProject(row) : null, html: restored.html, number: restored.number });
});

app.post("/api/projects/:id/cancel", async (c) => {
  const row = await getProject(c.env.DB, c.req.param("id"), c.get("ownerId"));
  if (!row) return c.json({ error: "Project not found" }, 404);
  if (row.status === "generating") {
    await setStatus(c.env.DB, row.id, "idle", null, Date.now());
  }
  return c.json({ ok: true });
});

app.post("/api/projects/:id/generate", (c) =>
  beginStream(c, "initial", async (row) => {
    const count = await versionCount(c.env.DB, row.id);
    if (count > 0) return { error: "This project already has a build. Send a follow-up instead." };
    return { text: row.idea };
  }),
);

app.post("/api/projects/:id/chat", (c) =>
  beginStream(c, "followup", async (row) => {
    const count = await versionCount(c.env.DB, row.id);
    if (count === 0) return { error: "Build the first version before asking for changes." };
    const body = await readJson(c);
    const content = typeof body.content === "string" ? body.content.trim() : "";
    if (content.length < 1 || content.length > 4000) {
      return { error: "Describe the change in 1 to 4000 characters." };
    }
    await insertMessage(c.env.DB, {
      id: crypto.randomUUID(),
      projectId: row.id,
      role: "user",
      agent: null,
      content,
      createdAt: Date.now(),
    });
    return { text: content };
  }),
);

app.notFound((c) => {
  if (c.req.path.startsWith("/api")) return c.json({ error: "Not found" }, 404);
  return c.env.ASSETS.fetch(c.req.raw);
});

export default app;

async function beginStream(
  c: Context<AppEnv>,
  mode: "initial" | "followup",
  prepare: (row: NonNullable<Awaited<ReturnType<typeof getProject>>>) => Promise<{ text: string } | { error: string }>,
) {
  const projectId = c.req.param("id") ?? "";
  const row = await getProject(c.env.DB, projectId, c.get("ownerId"));
  if (!row) return c.json({ error: "Project not found" }, 404);
  const prepared = await prepare(row);
  if ("error" in prepared) return c.json({ error: prepared.error }, 400);
  const locked = await acquireLock(c.env.DB, row.id, c.get("ownerId"), Date.now());
  if (!locked) {
    return c.json({ error: "The team is already working on this project." }, 409);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  const onClientAbort = () => controller.abort();
  c.req.raw.signal.addEventListener("abort", onClientAbort);

  return streamSSE(c, async (stream) => {
    const onAbort = () => controller.abort();
    if (typeof stream.onAbort === "function") stream.onAbort(onAbort);
    const emit = async (event: string, data: unknown) => {
      await stream.writeSSE({ event, data: JSON.stringify(data) });
    };
    try {
      await runPipeline({
        env: c.env,
        db: c.env.DB,
        projectId: row.id,
        idea: row.idea,
        mode,
        requestText: prepared.text,
        signal: controller.signal,
        emit,
      });
    } catch (error) {
      if (isAbort(error)) {
        await setStatus(c.env.DB, row.id, "idle", null, Date.now());
        const messageId = crypto.randomUUID();
        const content = "Generation stopped.";
        await insertMessage(c.env.DB, {
          id: messageId,
          projectId: row.id,
          role: "system",
          agent: null,
          content,
          createdAt: Date.now(),
        });
        await emit("message_start", { id: messageId, role: "system", agent: null });
        await emit("message_done", { id: messageId, content });
        await emit("done", { status: "idle" });
      } else {
        const message = safeError(error, c.env.OPENAI_API_KEY);
        await setStatus(c.env.DB, row.id, "error", message, Date.now());
        const messageId = crypto.randomUUID();
        await insertMessage(c.env.DB, {
          id: messageId,
          projectId: row.id,
          role: "system",
          agent: null,
          content: message,
          createdAt: Date.now(),
        });
        console.error(JSON.stringify({ event: "pipeline_error", projectId: row.id, message }));
        await emit("error", { message });
        await emit("message_start", { id: messageId, role: "system", agent: null });
        await emit("message_done", { id: messageId, content: message });
        await emit("done", { status: "error" });
      }
    } finally {
      clearTimeout(timer);
      c.req.raw.signal.removeEventListener("abort", onClientAbort);
    }
  });
}

function resolveOwner(c: Context<AppEnv>): string {
  const cookie = getCookie(c, "atoms_uid");
  if (isUuid(cookie)) return cookie;
  const header = c.req.header("x-owner-id");
  if (isUuid(header)) return header;
  return crypto.randomUUID();
}

async function readJson(c: Context<AppEnv>): Promise<Record<string, unknown>> {
  try {
    const value = await c.req.json();
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch {
    return {};
  }
  return {};
}

function isAbort(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === "AbortError" || /abort|cancel/i.test(error.message);
}

function safeError(error: unknown, key: string | undefined): string {
  const message = error instanceof Error ? error.message : "The team hit an unexpected error.";
  const redacted = key ? message.split(key).join("[redacted]") : message;
  return redacted.slice(0, 500);
}

function unpublishedPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Not published · Atoms Demo</title>
</head>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#efeae2;color:#1c1915;font-family:Georgia,serif">
  <main style="max-width:28rem;padding:2rem">
    <p style="letter-spacing:.14em;text-transform:uppercase;font-family:sans-serif;font-size:.75rem">Atoms Demo</p>
    <h1 style="font-size:2.4rem;line-height:1;margin:.4rem 0">This link isn't published.</h1>
    <p>Ask the owner to publish the project again from their workspace.</p>
  </main>
</body>
</html>`;
}
