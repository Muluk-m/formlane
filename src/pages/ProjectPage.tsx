import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import type { AgentId, AppVersion, ChatMessage, Project } from "../../shared/types";
import { ChatPane } from "../components/ChatPane";
import { Logo } from "../components/Logo";
import { Stage } from "../components/Stage";
import {
  cancelProject,
  downloadProject,
  getHealth,
  getProject,
  getVersion,
  publishProject,
  remixProject,
  restoreVersion,
  streamEvents,
  unpublishProject,
  type Health,
} from "../lib/api";
import { relativeTime } from "../lib/format";
import { useI18n } from "../lib/i18n";
import { slugify } from "../../shared/html";

type UiMessage = ChatMessage & { pending?: boolean };

export function ProjectPage() {
  const { id = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { t, locale } = useI18n();
  const [project, setProject] = useState<Project | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [versions, setVersions] = useState<AppVersion[]>([]);
  const [html, setHtml] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [active, setActive] = useState<AgentId | null>(null);
  const [pipeline, setPipeline] = useState<AgentId[]>([]);
  const [done, setDone] = useState<AgentId[]>([]);
  const [tab, setTab] = useState<"preview" | "code">("preview");
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [viewing, setViewing] = useState<(AppVersion & { html: string }) | null>(null);
  const [share, setShare] = useState<{ slug: string; url: string; versionId: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);
  const [split, setSplit] = useState(() => Number(localStorage.getItem("atoms-split")) || 420);
  const [wide, setWide] = useState(() => window.matchMedia("(min-width: 860px)").matches);
  const abortRef = useRef<AbortController | null>(null);
  const startedRef = useRef(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  async function refresh() {
    const detail = await getProject(id);
    setProject(detail.project);
    setMessages(detail.messages);
    setVersions(detail.versions);
    setHtml(detail.html ?? "");
    setCode(detail.html ?? "");
    return detail;
  }

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    Promise.all([getProject(id), getHealth()])
      .then(([detail, nextHealth]) => {
        if (cancel) return;
        setProject(detail.project);
        setMessages(detail.messages);
        setVersions(detail.versions);
        setHtml(detail.html ?? "");
        setCode(detail.html ?? "");
        setHealth(nextHealth);
        setLoading(false);
      })
      .catch((reason: unknown) => {
        if (cancel) return;
        setLoadError(reason instanceof Error ? reason.message : "Could not open this project.");
        setLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, [id]);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 860px)");
    const apply = () => setWide(media.matches);
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, [id]);

  async function run(path: string, body?: unknown) {
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setBanner(null);
    setActive(null);
    setDone([]);
    setViewing(null);
    const agentsByMessage = new Map<string, AgentId | null>();
    try {
      await streamEvents(path, body ?? {}, controller.signal, (event, data) => {
        if (event === "pipeline") {
          setPipeline((data.agents as AgentId[]) ?? []);
          setDone([]);
        } else if (event === "status" && typeof data.agent === "string") {
          setActive(data.agent as AgentId);
        } else if (event === "message_start") {
          const messageId = String(data.id);
          const agent = (data.agent as AgentId | null) ?? null;
          agentsByMessage.set(messageId, agent);
          setMessages((current) => [
            ...current,
            {
              id: messageId,
              role: data.role === "system" ? "system" : "agent",
              agent,
              content: "",
              createdAt: Date.now(),
              pending: true,
            },
          ]);
        } else if (event === "token") {
          const messageId = String(data.id);
          const text = String(data.text ?? "");
          setMessages((current) =>
            current.map((message) =>
              message.id === messageId ? { ...message, content: message.content + text } : message,
            ),
          );
        } else if (event === "message_replace" || event === "message_done") {
          const messageId = String(data.id);
          const content = String(data.content ?? "");
          setMessages((current) =>
            current.map((message) =>
              message.id === messageId
                ? { ...message, content, pending: event === "message_done" ? false : message.pending }
                : message,
            ),
          );
          if (event === "message_done") {
            const agent = agentsByMessage.get(messageId);
            if (agent) setDone((agents) => (agents.includes(agent) ? agents : [...agents, agent]));
          }
        } else if (event === "code_start") {
          setCode("");
        } else if (event === "code_reset") {
          setCode(String(data.text ?? ""));
        } else if (event === "code") {
          setCode((current) => current + String(data.text ?? ""));
        } else if (event === "preview" && typeof data.html === "string") {
          setViewing(null);
          setHtml(data.html);
        } else if (event === "version") {
          const version: AppVersion & { html?: string } = {
            id: String(data.id),
            number: Number(data.number),
            prompt: String(data.prompt ?? ""),
            createdAt: Number(data.createdAt),
            html: typeof data.html === "string" ? data.html : undefined,
          };
          if (version.html) {
            setHtml(version.html);
            setCode(version.html);
          }
          setVersions((current) => (current.some((item) => item.id === version.id) ? current : [...current, version]));
          setProject((current) =>
            current ? { ...current, currentVersionId: version.id, status: "idle", error: null } : current,
          );
          setViewing(null);
        } else if (event === "title" && typeof data.title === "string") {
          setProject((current) => (current ? { ...current, title: data.title as string } : current));
          document.title = `${data.title} · Atoms Demo`;
        } else if (event === "error") {
          setBanner(String(data.message ?? "The team hit an error."));
        }
      });
      await refresh();
    } catch (reason) {
      const aborted = reason instanceof DOMException && reason.name === "AbortError";
      if (aborted) {
        await cancelProject(id).catch(() => undefined);
        await refresh().catch(() => undefined);
      } else {
        setBanner(reason instanceof Error ? reason.message : "The team hit an error.");
        await refresh().catch(() => undefined);
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setRunning(false);
      setActive(null);
    }
  }

  function runGenerate() {
    return run(`/api/projects/${id}/generate`);
  }

  useEffect(() => {
    if (!project || startedRef.current) return;
    const state = location.state as { autostart?: boolean } | null;
    if (!state?.autostart) return;
    const key = `atoms-autostart-${id}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
    startedRef.current = true;
    navigate(".", { replace: true, state: null });
    void runGenerate();
    // runGenerate closes over the latest id; autostart happens once per project.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, id]);

  function onDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (!wide) return;
    event.preventDefault();
    const startX = event.clientX;
    const startW = split;
    const previous = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    const move = (ev: PointerEvent) => {
      const next = Math.min(680, Math.max(320, startW + ev.clientX - startX));
      setSplit(next);
      localStorage.setItem("atoms-split", String(next));
    };
    const up = () => {
      document.body.style.userSelect = previous;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  async function send(text: string) {
    const optimistic: UiMessage = {
      id: `tmp-${crypto.randomUUID()}`,
      role: "user",
      agent: null,
      content: text,
      createdAt: Date.now(),
    };
    setMessages((current) => [...current, optimistic]);
    await run(`/api/projects/${id}/chat`, { content: text });
  }

  async function openVersion(versionId: string) {
    const version = await getVersion(id, versionId);
    setViewing(version);
    setTab("preview");
  }

  async function restore(versionId: string) {
    const result = await restoreVersion(id, versionId);
    setHtml(result.html);
    setCode(result.html);
    setViewing(null);
    await refresh();
  }

  async function publish() {
    const result = await publishProject(id);
    setShare(result);
    setProject((current) =>
      current
        ? { ...current, publishedSlug: result.slug, publishedVersionId: result.versionId }
        : current,
    );
    setCopied(false);
  }

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!share || !dialog || dialog.open) return;
    dialog.showModal();
  }, [share]);

  async function unpublish() {
    await unpublishProject(id);
    setProject((current) => (current ? { ...current, publishedSlug: null, publishedVersionId: null } : current));
    setShare(null);
    dialogRef.current?.close();
  }

  async function remix() {
    const copy = await remixProject(id);
    navigate(`/project/${copy.id}`);
  }

  if (loading) {
    return (
      <div className="grid min-h-dvh place-items-center text-muted">
        <p>Loading project…</p>
      </div>
    );
  }
  if (loadError || !project) {
    return (
      <main className="grid min-h-dvh place-items-center px-6">
        <div>
          <h1 className="font-serif text-4xl">{loadError ?? t("notFound")}</h1>
          <Link to="/" className="mt-4 inline-block text-accent">
            {t("home")}
          </Link>
        </div>
      </main>
    );
  }

  const displayHtml = viewing?.html ?? html;
  const displayCode = viewing?.html ?? code;
  const publishedCurrent = Boolean(project.publishedSlug && project.publishedVersionId === project.currentVersionId);
  const publishLabel = !project.publishedSlug ? t("publish") : publishedCurrent ? t("published") : t("updateLive");
  const interrupted = project.status === "generating" && !running && Date.now() - project.updatedAt > 20_000;

  return (
    <div className="flex h-dvh flex-col bg-paper text-ink">
      <header className="flex items-center gap-3 border-b border-line px-3 py-2">
        <Link to="/" className="shrink-0" aria-label={t("back")}>
          <Logo compact />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-serif text-xl leading-none">{project.title}</h1>
          <p className="truncate text-xs text-muted">
            {versions.length} {versions.length === 1 ? t("version") : t("versions")}
            {health?.mock ? ` · ${t("mockPill")}` : health ? ` · ${t("livePill")} ${health.model}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-1.5 text-sm">
          <button type="button" data-testid="history-button" className="rounded-full border border-line bg-card px-3 py-1.5" onClick={() => setHistoryOpen(true)}>
            {t("history")}
          </button>
          <button type="button" data-testid="remix-button" className="rounded-full border border-line bg-card px-3 py-1.5" onClick={() => void remix()}>
            {t("remix")}
          </button>
          <button
            type="button"
            data-testid="download-button"
            disabled={!project.currentVersionId}
            className="rounded-full border border-line bg-card px-3 py-1.5 disabled:opacity-40"
            onClick={() =>
              void downloadProject(
                id,
                `${slugify(project.title)}-v${versions.at(-1)?.number ?? 1}.html`,
                viewing?.id,
              )
            }
          >
            {t("download")}
          </button>
          <button
            type="button"
            data-testid="publish-button"
            disabled={!project.currentVersionId || running}
            className="rounded-full bg-accent px-3 py-1.5 font-semibold text-white disabled:opacity-40"
            onClick={() => void publish()}
          >
            {publishLabel}
          </button>
        </div>
      </header>
      {(banner || project.error || interrupted) && !running && (
        <div className="flex items-center justify-between gap-3 border-b border-line bg-[#f8ece6] px-4 py-2 text-sm">
          <p>{banner || project.error || t("interrupted")}</p>
          {!html && (
            <button type="button" className="font-semibold" onClick={() => void runGenerate()} data-testid="retry-button">
              {interrupted ? t("takeOver") : t("retry")}
            </button>
          )}
          {interrupted && html && (
            <button
              type="button"
              className="font-semibold"
              onClick={() => {
                void cancelProject(id).then(() => refresh());
              }}
            >
              {t("takeOver")}
            </button>
          )}
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div className="min-h-0 md:h-auto" style={wide ? { width: split } : { height: "48%" }}>
          <ChatPane
            messages={messages}
            running={running}
            active={active}
            pipeline={pipeline}
            done={done}
            locale={locale}
            placeholder={t("followPlaceholder")}
            sendLabel={t("send")}
            stopLabel={t("stop")}
            onSend={(text) => void send(text)}
            onStop={() => abortRef.current?.abort()}
          />
        </div>
        <div className="splitter" role="separator" aria-orientation="vertical" tabIndex={0} onPointerDown={onDrag} />
        <Stage
          html={displayHtml}
          code={displayCode}
          tab={tab}
          device={device}
          running={running}
          staleLabel={viewing ? `${t("viewing")} · v${viewing.number}` : null}
          onTab={setTab}
          onDevice={setDevice}
          onBack={() => setViewing(null)}
          labels={{
            preview: t("preview"),
            code: t("code"),
            desktop: t("desktop"),
            mobile: t("mobile"),
            files: t("files"),
            emptyPreview: t("emptyPreview"),
            emptyCode: t("emptyCode"),
            backToCurrent: t("backToCurrent"),
          }}
        />
      </div>
      {historyOpen && (
        <div className="fixed inset-0 z-20 flex justify-end bg-ink/30" onClick={() => setHistoryOpen(false)}>
          <aside
            className="h-full w-full max-w-md overflow-y-auto bg-card p-5 shadow-xl"
            data-testid="version-drawer"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="font-serif text-3xl">{t("history")}</h2>
              <button type="button" onClick={() => setHistoryOpen(false)} className="text-sm">
                {t("close")}
              </button>
            </div>
            <ul className="mt-4 flex flex-col gap-2">
              {versions.length === 0 && <li className="text-sm text-muted">{t("emptyCode")}</li>}
              {[...versions].reverse().map((version) => {
                const current = version.id === project.currentVersionId;
                return (
                  <li key={version.id} className="rounded-2xl border border-line p-3">
                    <button type="button" className="w-full text-left" onClick={() => void openVersion(version.id)}>
                      <span className="font-semibold">v{version.number}</span>{" "}
                      {current && <span className="text-xs text-accent">{t("current")}</span>}
                      <span className="mt-1 block text-sm text-muted">{version.prompt}</span>
                      <span className="mt-1 block text-xs text-muted">{relativeTime(version.createdAt, locale)}</span>
                    </button>
                    {!current && (
                      <button
                        type="button"
                        className="mt-2 text-sm font-semibold text-accent"
                        data-testid={`restore-${version.number}`}
                        onClick={() => void restore(version.id)}
                      >
                        {t("restore")}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </aside>
        </div>
      )}
      <dialog ref={dialogRef}>
        <h2 className="font-serif text-3xl">{t("published")}</h2>
        <p className="mt-2 text-sm text-muted">{t("liveNote")}</p>
        <input
          readOnly
          data-testid="share-url"
          value={share?.url ?? ""}
          className="mt-4 w-full rounded-xl border border-line bg-paper px-3 py-2"
          onFocus={(event) => event.currentTarget.select()}
        />
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-full bg-ink px-4 py-2 text-sm text-card"
            onClick={() => {
              if (!share) return;
              void navigator.clipboard.writeText(share.url).then(() => setCopied(true));
            }}
          >
            {copied ? t("copied") : t("copyLink")}
          </button>
          {share && (
            <a className="rounded-full border border-line px-4 py-2 text-sm" href={share.url} target="_blank" rel="noreferrer">
              {t("preview")}
            </a>
          )}
          <button type="button" className="rounded-full border border-line px-4 py-2 text-sm" onClick={() => void unpublish()}>
            {t("unpublish")}
          </button>
          <button type="button" className="ml-auto text-sm" onClick={() => dialogRef.current?.close()}>
            {t("close")}
          </button>
        </div>
      </dialog>
    </div>
  );
}
