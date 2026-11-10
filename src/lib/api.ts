import type { AppVersion, ChatMessage, Project } from "../../shared/types";

export interface ProjectDetail {
  project: Project;
  messages: ChatMessage[];
  versions: AppVersion[];
  html: string | null;
}

export interface Health {
  ok: boolean;
  mock: boolean;
  model: string;
  hasKey: boolean;
}

let ownerPromise: Promise<string> | null = null;

export function ensureOwner(): Promise<string> {
  if (!ownerPromise) {
    ownerPromise = (async () => {
      const stored = localStorage.getItem("atoms_uid");
      const response = await fetch("/api/me", {
        credentials: "include",
        headers: stored ? { "x-owner-id": stored } : {},
      });
      if (!response.ok) throw new Error("Could not start a browser session.");
      const data = (await response.json()) as { ownerId: string };
      localStorage.setItem("atoms_uid", data.ownerId);
      return data.ownerId;
    })().catch((error: unknown) => {
      ownerPromise = null;
      throw error;
    });
  }
  return ownerPromise;
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const ownerId = await ensureOwner();
  const headers = new Headers(init.headers);
  headers.set("x-owner-id", ownerId);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return fetch(path, { ...init, headers, credentials: "include" });
}

async function readError(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { error?: string };
    if (data.error) return data.error;
  } catch {
    /* ignore */
  }
  return `Request failed (${response.status})`;
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await request(path, init);
  if (!response.ok) throw new Error(await readError(response));
  return (await response.json()) as T;
}

export function getHealth(): Promise<Health> {
  return json<Health>("/api/health");
}

export function listProjects(): Promise<Project[]> {
  return json<{ projects: Project[] }>("/api/projects").then((data) => data.projects);
}

export function createProject(idea: string): Promise<Project> {
  return json<{ project: Project }>("/api/projects", {
    method: "POST",
    body: JSON.stringify({ idea }),
  }).then((data) => data.project);
}

export function getProject(id: string): Promise<ProjectDetail> {
  return json<ProjectDetail>(`/api/projects/${id}`);
}

export function deleteProject(id: string): Promise<void> {
  return json(`/api/projects/${id}`, { method: "DELETE" });
}

export function getVersion(id: string, versionId: string): Promise<AppVersion & { html: string }> {
  return json<{ version: AppVersion & { html: string } }>(`/api/projects/${id}/versions/${versionId}`).then(
    (data) => data.version,
  );
}

export function restoreVersion(id: string, versionId: string): Promise<{ html: string; number: number }> {
  return json(`/api/projects/${id}/restore`, {
    method: "POST",
    body: JSON.stringify({ versionId }),
  });
}

export function publishProject(id: string): Promise<{ slug: string; url: string; versionId: string }> {
  return json(`/api/projects/${id}/publish`, { method: "POST", body: "{}" });
}

export function unpublishProject(id: string): Promise<void> {
  return json(`/api/projects/${id}/unpublish`, { method: "POST", body: "{}" });
}

export function remixProject(id: string): Promise<Project> {
  return json<{ project: Project }>(`/api/projects/${id}/remix`, { method: "POST", body: "{}" }).then(
    (data) => data.project,
  );
}

export function cancelProject(id: string): Promise<void> {
  return json(`/api/projects/${id}/cancel`, { method: "POST", body: "{}" });
}

export async function downloadProject(id: string, filename: string, versionId?: string): Promise<void> {
  const query = versionId ? `?version=${encodeURIComponent(versionId)}` : "";
  const response = await request(`/api/projects/${id}/download${query}`);
  if (!response.ok) throw new Error(await readError(response));
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function streamEvents(
  path: string,
  body: unknown,
  signal: AbortSignal,
  onEvent: (event: string, data: Record<string, unknown>) => void,
): Promise<void> {
  const ownerId = await ensureOwner();
  const response = await fetch(path, {
    method: "POST",
    credentials: "include",
    signal,
    headers: {
      "content-type": "application/json",
      "x-owner-id": ownerId,
    },
    body: body == null ? "{}" : JSON.stringify(body),
  });
  const type = response.headers.get("content-type") ?? "";
  if (!response.ok || !type.includes("text/event-stream") || !response.body) {
    throw new Error(await readError(response));
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      if (!part.trim() || part.trimStart().startsWith(":")) continue;
      let event = "message";
      const dataLines: string[] = [];
      for (const line of part.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      }
      if (!dataLines.length) continue;
      onEvent(event, JSON.parse(dataLines.join("\n")) as Record<string, unknown>);
    }
  }
}
