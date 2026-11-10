import type { Env } from "./env";
import { mockEnabled, modelName, openAiBase } from "./env";

export interface ChatTurn {
  role: "system" | "user" | "assistant";
  content: string;
}

export function takeContentDelta(payload: string): string | null {
  if (!payload || payload === "[DONE]") return null;
  let json: {
    choices?: Array<{ delta?: { content?: string } }>;
    error?: { message?: string };
  };
  try {
    json = JSON.parse(payload) as typeof json;
  } catch {
    return null;
  }
  if (json.error?.message) throw new Error(json.error.message);
  const delta = json.choices?.[0]?.delta?.content;
  return typeof delta === "string" ? delta : "";
}

export async function streamChat(
  env: Env,
  messages: ChatTurn[],
  maxTokens: number,
  temperature: number,
  signal: AbortSignal,
  onDelta: (text: string) => Promise<void>,
): Promise<string> {
  if (mockEnabled(env)) {
    throw new Error("Mock mode should not call the OpenAI API.");
  }
  const key = env.OPENAI_API_KEY?.trim();
  if (!key) {
    throw new Error(
      "OPENAI_API_KEY is not set. For local mock mode, set MOCK_LLM=true in .dev.vars or run npm run dev:mock.",
    );
  }

  const response = await fetch(`${openAiBase(env)}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: modelName(env),
      messages,
      temperature,
      max_tokens: maxTokens,
      stream: true,
    }),
    signal,
  });

  if (!response.ok || !response.body) {
    const detail = (await response.text()).slice(0, 400);
    throw new Error(redact(`OpenAI error ${response.status}: ${detail || response.statusText}`, key));
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const delta = takeContentDelta(trimmed.slice(5).trim());
        if (!delta) continue;
        full += delta;
        await onDelta(delta);
      }
    }
  } catch (error) {
    throw new Error(redact(error instanceof Error ? error.message : "OpenAI stream failed", key));
  }
  return full;
}

function redact(message: string, key: string): string {
  return key ? message.split(key).join("[redacted]") : message;
}
