const base = process.env.BASE_URL ?? "http://127.0.0.1:8787";
const ownerA = crypto.randomUUID();
const ownerB = crypto.randomUUID();

function headers(owner, extra = {}) {
  return { "content-type": "application/json", "x-owner-id": owner, ...extra };
}

async function json(path, options = {}, owner = ownerA) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: headers(owner, options.headers),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!response.ok) {
    throw new Error(`${options.method ?? "GET"} ${path} -> ${response.status} ${text.slice(0, 300)}`);
  }
  return { data, response };
}

async function stream(path, body, owner = ownerA) {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: headers(owner),
    body: JSON.stringify(body ?? {}),
  });
  if (!response.ok || !response.body) {
    throw new Error(`stream ${path} -> ${response.status} ${await response.text()}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      if (!part.trim()) continue;
      let event = "message";
      const dataLines = [];
      for (const line of part.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      }
      if (dataLines.length) events.push({ event, data: JSON.parse(dataLines.join("\n")) });
    }
  }
  return events;
}

const health = await json("/api/health");
if (!health.data.mock) throw new Error("expected mock mode");

const created = await json("/api/projects", {
  method: "POST",
  body: JSON.stringify({
    idea: "A weekend farmers market map for a small coastal town. Shoppers filter stalls by what's in season, save a shortlist, and see which stalls take cards.",
  }),
});
const id = created.data.project.id;
const events = await stream(`/api/projects/${id}/generate`);
const names = events.filter((event) => event.event === "message_start" && event.data.agent).map((event) => event.data.agent);
for (const agent of ["mike", "emma", "bob", "alex", "david"]) {
  if (!names.includes(agent)) throw new Error(`missing agent ${agent}: ${names.join(",")}`);
}
if (!events.some((event) => event.event === "token")) throw new Error("no streamed tokens");
const version = events.find((event) => event.event === "version");
if (!version?.data?.html?.includes("<!DOCTYPE html>")) throw new Error("version html missing");
if (!version.data.html.toLowerCase().includes("farmers")) throw new Error("preview ignored the idea");

const detail = await json(`/api/projects/${id}`);
if (detail.data.messages.length < 5) throw new Error("messages were not persisted");
if (!detail.data.html.includes("<!DOCTYPE html>")) throw new Error("reload lost html");
if (detail.data.versions.length !== 1) throw new Error("expected version 1");

const follow = await stream(`/api/projects/${id}/chat`, {
  content: "Make the page dark and add a packing checklist",
});
const version2 = follow.find((event) => event.event === "version");
if (version2?.data?.number !== 2) throw new Error("follow-up did not create version 2");
if (!version2.data.html.toLowerCase().includes("packing checklist")) throw new Error("edit was not applied");
if (!version2.data.html.includes("#141311")) throw new Error("dark theme missing");

const reloaded = await json(`/api/projects/${id}`);
if (reloaded.data.versions.length !== 2) throw new Error("reload lost version 2");
if (!reloaded.data.html.includes("packing checklist")) throw new Error("reload lost the edit");

const published = await json(`/api/projects/${id}/publish`, { method: "POST", body: "{}" });
const page = await fetch(`${base}/p/${published.data.slug}`);
const pageHtml = await page.text();
if (page.status !== 200 || !pageHtml.includes("packing checklist")) throw new Error("publish link failed");

const restored = await json(`/api/projects/${id}/restore`, {
  method: "POST",
  body: JSON.stringify({ versionId: detail.data.versions[0].id }),
});
if (!restored.data.html.toLowerCase().includes("farmers") || restored.data.html.includes("packing checklist")) {
  throw new Error("restore did not return version 1");
}

const remix = await json(`/api/projects/${id}/remix`, { method: "POST", body: "{}" });
if (remix.data.project.id === id) throw new Error("remix reused the id");
const copy = await json(`/api/projects/${remix.data.project.id}`);
if (copy.data.versions.length < 2) throw new Error("remix did not copy versions");

const denied = await fetch(`${base}/api/projects/${id}`, { headers: headers(ownerB) });
if (denied.status !== 404) throw new Error(`other owner should 404, got ${denied.status}`);

const download = await fetch(`${base}/api/projects/${id}/download`, { headers: headers(ownerA) });
const file = await download.text();
if (!download.ok || !file.startsWith("<!DOCTYPE html>")) throw new Error("download failed");
const disposition = download.headers.get("content-disposition") ?? "";
if (!disposition.includes("attachment")) throw new Error("download missing attachment header");

const home = await fetch(`${base}/`);
if (!home.ok || !(await home.text()).includes("Atoms Demo")) throw new Error("spa shell missing");
const route = await fetch(`${base}/project/${id}`);
if (!route.ok || !(await route.text()).includes('id="root"')) throw new Error("spa fallback missing");

console.log(
  JSON.stringify(
    {
      ok: true,
      id,
      agents: names,
      versions: reloaded.data.versions.length,
      slug: published.data.slug,
      remix: remix.data.project.id,
      events: events.length,
    },
    null,
    2,
  ),
);
