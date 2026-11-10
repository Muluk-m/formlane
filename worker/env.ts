export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  OPENAI_MODEL?: string;
  MOCK_LLM?: string;
  MOCK_DELAY_MS?: string;
}

export function mockEnabled(env: Env): boolean {
  const flag = (env.MOCK_LLM ?? "").trim().toLowerCase();
  return flag === "1" || flag === "true" || flag === "yes" || flag === "on";
}

export function modelName(env: Env): string {
  return env.OPENAI_MODEL?.trim() || "gpt-4.1";
}

export function openAiBase(env: Env): string {
  return (env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1").replace(/\/$/, "");
}
