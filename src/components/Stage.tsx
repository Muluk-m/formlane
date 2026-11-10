import { useEffect, useState } from "react";
import { formatBytes } from "../lib/format";
import { highlightHtml } from "../lib/highlight";

export function Stage({
  html,
  code,
  tab,
  device,
  running,
  staleLabel,
  onTab,
  onDevice,
  onBack,
  labels,
}: {
  html: string;
  code: string;
  tab: "preview" | "code";
  device: "desktop" | "mobile";
  running: boolean;
  staleLabel: string | null;
  onTab: (tab: "preview" | "code") => void;
  onDevice: (device: "desktop" | "mobile") => void;
  onBack: () => void;
  labels: {
    preview: string;
    code: string;
    desktop: string;
    mobile: string;
    files: string;
    emptyPreview: string;
    emptyCode: string;
    backToCurrent: string;
  };
}) {
  return (
    <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-paper-deep">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="flex rounded-full bg-card p-1 text-sm">
          <button
            type="button"
            data-testid="tab-preview"
            className={`rounded-full px-3 py-1 ${tab === "preview" ? "bg-ink text-card" : ""}`}
            onClick={() => onTab("preview")}
          >
            {labels.preview}
          </button>
          <button
            type="button"
            data-testid="tab-code"
            className={`rounded-full px-3 py-1 ${tab === "code" ? "bg-ink text-card" : ""}`}
            onClick={() => onTab("code")}
          >
            {labels.code}
            {running && tab !== "code" && <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-accent" />}
          </button>
        </div>
        {tab === "preview" && (
          <div className="flex rounded-full bg-card p-1 text-sm">
            <button
              type="button"
              data-testid="device-desktop"
              className={`rounded-full px-3 py-1 ${device === "desktop" ? "bg-ink text-card" : ""}`}
              onClick={() => onDevice("desktop")}
            >
              {labels.desktop}
            </button>
            <button
              type="button"
              data-testid="device-mobile"
              className={`rounded-full px-3 py-1 ${device === "mobile" ? "bg-ink text-card" : ""}`}
              onClick={() => onDevice("mobile")}
            >
              {labels.mobile}
            </button>
          </div>
        )}
      </div>
      {staleLabel && (
        <div className="mx-4 mb-2 flex items-center justify-between rounded-xl bg-card px-3 py-2 text-sm">
          <span>{staleLabel}</span>
          <button type="button" className="font-semibold text-accent" onClick={onBack} data-testid="back-current">
            {labels.backToCurrent}
          </button>
        </div>
      )}
      <div className="min-h-0 flex-1 px-4 pb-4">
        {tab === "preview" ? (
          <div className="flex h-full items-stretch justify-center">
            {html ? (
              <div className={`device ${device}`} data-testid="preview-frame">
                <div className="flex h-9 items-center gap-2 border-b border-line bg-[#f6f3ee] px-3">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#e2b4a4]" />
                  <span className="h-2.5 w-2.5 rounded-full bg-[#ecd28a]" />
                  <span className="h-2.5 w-2.5 rounded-full bg-[#b7d3b0]" />
                  <span className="ml-2 truncate text-xs text-muted">preview.local</span>
                </div>
                <iframe title="App preview" sandbox="allow-scripts allow-forms allow-popups" srcDoc={html} />
              </div>
            ) : (
              <div className="grid h-full w-full place-items-center rounded-2xl border border-dashed border-line bg-card/70 px-8 text-center text-muted">
                <p className="max-w-sm">{labels.emptyPreview}</p>
              </div>
            )}
          </div>
        ) : (
          <div className="flex h-full overflow-hidden rounded-2xl border border-ink/10" data-testid="code-view">
            <aside className="hidden w-44 shrink-0 border-r border-white/10 bg-[#161412] p-3 text-sm text-[#f4efe6] sm:block">
              <p className="mb-2 text-xs uppercase tracking-[0.14em] text-[#a89880]">{labels.files}</p>
              <p className={`rounded-lg px-2 py-1.5 ${code ? "bg-white/10" : "text-[#a89880]"}`}>index.html</p>
              {code && <p className="mt-2 px-2 text-xs text-[#a89880]">{formatBytes(new Blob([code]).size)}</p>}
            </aside>
            {code ? <CodeBlock code={code} running={running} /> : <div className="grid flex-1 place-items-center bg-[#1c1915] text-[#a89880]">{labels.emptyCode}</div>}
          </div>
        )}
      </div>
    </section>
  );
}

function CodeBlock({ code, running }: { code: string; running: boolean }) {
  const [pretty, setPretty] = useState(() => highlightHtml(code));
  useEffect(() => {
    const handle = window.setTimeout(() => setPretty(highlightHtml(code)), running ? 160 : 0);
    return () => window.clearTimeout(handle);
  }, [code, running]);
  const lines = pretty.split("\n");
  return (
    <pre className="code-sheet flex-1">
      {lines.map((line, index) => (
        <span key={index} className="code-line" dangerouslySetInnerHTML={{ __html: line || " " }} />
      ))}
    </pre>
  );
}
