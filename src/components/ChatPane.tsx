import { useEffect, useRef } from "react";
import { AGENTS } from "../../shared/agents";
import type { AgentId, ChatMessage } from "../../shared/types";
import type { Locale } from "../lib/i18n";
import { AgentAvatar } from "./AgentAvatar";
import { RichText } from "./RichText";

type UiMessage = ChatMessage & { pending?: boolean };

export function ChatPane({
  messages,
  running,
  active,
  pipeline,
  done,
  locale,
  placeholder,
  sendLabel,
  stopLabel,
  onSend,
  onStop,
}: {
  messages: UiMessage[];
  running: boolean;
  active: AgentId | null;
  pipeline: AgentId[];
  done: AgentId[];
  locale: Locale;
  placeholder: string;
  sendLabel: string;
  stopLabel: string;
  onSend: (text: string) => void;
  onStop: () => void;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, active]);

  function submit() {
    const value = inputRef.current?.value.trim() ?? "";
    if (!value || running) return;
    onSend(value);
    if (inputRef.current) inputRef.current.value = "";
  }

  const status = active ? (locale === "zh" ? AGENTS[active].statusZh : AGENTS[active].status) : null;

  return (
    <section className="flex h-full min-h-0 flex-col bg-card" aria-label="Chat">
      {pipeline.length > 0 && running && (
        <ol className="flex gap-1.5 overflow-x-auto border-b border-line px-4 py-3 text-xs">
          {pipeline.map((id) => {
            const state = done.includes(id) ? "done" : active === id ? "now" : "wait";
            return (
              <li
                key={id}
                className={`rounded-full px-2.5 py-1 whitespace-nowrap ${
                  state === "now"
                    ? "bg-ink text-card"
                    : state === "done"
                      ? "bg-accent-soft text-accent"
                      : "bg-paper text-muted"
                }`}
              >
                {AGENTS[id].name}
              </li>
            );
          })}
        </ol>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4" data-testid="chat-log">
        <div className="flex flex-col gap-4">
          {messages.map((message) => (
            <MessageBubble key={message.id} message={message} locale={locale} />
          ))}
          <div ref={endRef} />
        </div>
      </div>
      <div className="border-t border-line p-3">
        {status && (
          <p className="mb-2 flex items-center gap-2 px-1 text-sm text-muted" data-testid="agent-status">
            <span className="inline-block h-2 w-2 rounded-full bg-accent caret" />
            {status}
          </p>
        )}
        <div className="rounded-2xl border border-line bg-paper p-2">
          <textarea
            ref={inputRef}
            data-testid="followup-input"
            rows={2}
            disabled={running}
            placeholder={placeholder}
            className="w-full resize-none bg-transparent px-2 py-1 outline-none placeholder:text-muted disabled:opacity-60"
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                submit();
              }
            }}
          />
          <div className="flex justify-end gap-2">
            {running ? (
              <button
                type="button"
                data-testid="stop-button"
                onClick={onStop}
                className="rounded-full border border-line px-3 py-1.5 text-sm"
              >
                {stopLabel}
              </button>
            ) : (
              <button
                type="button"
                data-testid="send-button"
                onClick={submit}
                className="rounded-full bg-ink px-3 py-1.5 text-sm text-card"
              >
                {sendLabel}
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function MessageBubble({ message, locale }: { message: UiMessage; locale: Locale }) {
  if (message.role === "system") {
    const version = message.content.match(/^Saved version (\d+)\./);
    return (
      <div className="flex justify-center">
        <p className="rounded-full bg-paper px-3 py-1 text-xs text-muted">
          {version ? (locale === "zh" ? `已保存版本 ${version[1]}` : `Version ${version[1]} ready`) : message.content}
        </p>
      </div>
    );
  }
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[90%] rounded-2xl rounded-br-md bg-ink px-3 py-2 text-sm text-card">
          <RichText text={message.content} />
        </div>
      </div>
    );
  }
  const agent = message.agent ? AGENTS[message.agent] : null;
  return (
    <article className="flex gap-3">
      {message.agent && <AgentAvatar id={message.agent} />}
      <div className="min-w-0">
        <p className="text-sm">
          <span className="font-semibold">{agent?.name}</span>{" "}
          <span className="text-muted">{locale === "zh" ? agent?.roleZh : agent?.role}</span>
        </p>
        <div className="mt-1 text-sm leading-6">
          <RichText text={message.content} />
          {message.pending && <span className="caret" />}
        </div>
      </div>
    </article>
  );
}
