import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AGENTS } from "../../shared/agents";
import { AGENT_ORDER, type Project } from "../../shared/types";
import { Logo } from "../components/Logo";
import { AgentAvatar } from "../components/AgentAvatar";
import { createProject, deleteProject, getHealth, listProjects, type Health } from "../lib/api";
import { relativeTime } from "../lib/format";
import { useI18n } from "../lib/i18n";

export function HomePage() {
  const { t, locale, setLocale, examples } = useI18n();
  const navigate = useNavigate();
  const [idea, setIdea] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    let cancel = false;
    Promise.all([listProjects(), getHealth()])
      .then(([nextProjects, nextHealth]) => {
        if (cancel) return;
        setProjects(nextProjects);
        setHealth(nextHealth);
      })
      .catch((reason: unknown) => {
        if (!cancel) setError(reason instanceof Error ? reason.message : "Could not load projects.");
      });
    return () => {
      cancel = true;
    };
  }, []);

  async function submit(text: string) {
    const next = text.trim();
    if (!next || busy) return;
    setBusy(true);
    setError(null);
    try {
      const project = await createProject(next);
      navigate(`/project/${project.id}`, { state: { autostart: true } });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not start.");
      setBusy(false);
    }
  }

  async function remove(project: Project) {
    const confirmed = window.confirm(locale === "zh" ? `删除「${project.title}」？` : `Delete “${project.title}”?`);
    if (!confirmed) return;
    await deleteProject(project.id);
    setProjects((current) => current?.filter((item) => item.id !== project.id) ?? []);
  }

  return (
    <div className="landing-bg min-h-dvh">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <Logo />
        <div className="flex items-center gap-2 text-sm">
          <button
            type="button"
            className={`rounded-full px-3 py-1 ${locale === "en" ? "bg-ink text-card" : ""}`}
            onClick={() => setLocale("en")}
          >
            EN
          </button>
          <button
            type="button"
            className={`rounded-full px-3 py-1 ${locale === "zh" ? "bg-ink text-card" : ""}`}
            onClick={() => setLocale("zh")}
          >
            中文
          </button>
          <a href="#projects" className="hidden rounded-full border border-line bg-card px-3 py-1 sm:inline">
            {t("projects")}
          </a>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-5 pb-20">
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-accent">{t("kicker")}</p>
        <h1 className="mt-3 max-w-4xl font-serif text-5xl leading-[0.95] tracking-tight sm:text-7xl">{t("hero")}</h1>
        <p className="mt-5 max-w-2xl text-lg text-muted">{t("sub")}</p>
        {health && !health.mock && !health.hasKey && (
          <p className="mt-4 max-w-2xl rounded-2xl border border-line bg-card px-4 py-3 text-sm">{t("noKey")}</p>
        )}
        {health?.mock && (
          <p className="mt-4 inline-flex rounded-full bg-accent-soft px-3 py-1 text-sm text-accent">
            {t("mockPill")}
          </p>
        )}
        <form
          className="mt-8 rounded-[28px] border border-line bg-card p-3 shadow-[0_20px_60px_rgba(48,32,16,0.08)]"
          onSubmit={(event) => {
            event.preventDefault();
            void submit(idea);
          }}
        >
          <textarea
            data-testid="idea-input"
            value={idea}
            onChange={(event) => setIdea(event.target.value)}
            rows={4}
            maxLength={4000}
            placeholder={t("placeholder")}
            className="w-full resize-none bg-transparent px-3 py-2 text-lg outline-none placeholder:text-muted"
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void submit(idea);
              }
            }}
          />
          <div className="flex items-center justify-between gap-3 px-2 pb-1">
            <span className="text-xs text-muted">{t("hint")}</span>
            <button
              type="submit"
              data-testid="build-button"
              disabled={busy || idea.trim().length === 0}
              className="rounded-full bg-accent px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {busy ? t("building") : t("build")}
            </button>
          </div>
        </form>
        {error && <p className="mt-3 text-sm text-bad">{error}</p>}
        <div className="mt-4">
          <p className="mb-2 text-xs uppercase tracking-[0.14em] text-muted">{t("examples")}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {examples.map((example, index) => (
              <button
                key={example.title}
                type="button"
                data-testid={`example-${index}`}
                onClick={() => setIdea(example.prompt)}
                className="rounded-2xl border border-line bg-card/80 px-4 py-3 text-left hover:border-ink/30"
              >
                <span className="block text-sm font-semibold">{example.title}</span>
                <span className="mt-1 block text-sm text-muted">{example.prompt}</span>
              </button>
            ))}
          </div>
        </div>

        <section className="mt-14">
          <h2 className="font-serif text-3xl">{t("team")}</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {AGENT_ORDER.map((id) => {
              const agent = AGENTS[id];
              return (
                <article key={id} className="rounded-2xl border border-line bg-card p-4">
                  <AgentAvatar id={id} />
                  <h3 className="mt-3 font-semibold">{agent.name}</h3>
                  <p className="text-sm text-accent">{locale === "zh" ? agent.roleZh : agent.role}</p>
                  <p className="mt-2 text-sm text-muted">{locale === "zh" ? agent.blurbZh : agent.blurb}</p>
                </article>
              );
            })}
          </div>
        </section>

        <section id="projects" className="mt-14">
          <h2 className="font-serif text-3xl">{t("projects")}</h2>
          {projects && projects.length === 0 && <p className="mt-3 max-w-xl text-muted">{t("empty")}</p>}
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {projects?.map((project) => (
              <article key={project.id} className="rounded-2xl border border-line bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <Link to={`/project/${project.id}`} className="font-serif text-2xl leading-none hover:text-accent" data-testid="project-link">
                      {project.title}
                    </Link>
                    <p className="mt-2 line-clamp-2 text-sm text-muted">{project.idea}</p>
                  </div>
                  {project.publishedSlug && (
                    <span className="rounded-full bg-accent-soft px-2 py-1 text-xs text-accent">{t("published")}</span>
                  )}
                </div>
                <div className="mt-4 flex items-center justify-between text-xs text-muted">
                  <span>
                    {project.versionCount ?? 0} {(project.versionCount ?? 0) === 1 ? t("version") : t("versions")} ·{" "}
                    {relativeTime(project.updatedAt, locale)}
                  </span>
                  <button type="button" className="text-bad" onClick={() => void remove(project)}>
                    {t("delete")}
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
        <p className="mt-12 text-sm text-muted">{t("noAccount")}</p>
      </main>
    </div>
  );
}
