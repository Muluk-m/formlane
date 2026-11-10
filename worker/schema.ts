import sql from "../migrations/0001_init.sql";

export const SCHEMA = sql;

let ready: Promise<void> | null = null;

export function ensureSchema(db: D1Database): Promise<void> {
  if (!ready) {
    ready = applySchema(db).catch((error: unknown) => {
      ready = null;
      throw error;
    });
  }
  return ready;
}

async function applySchema(db: D1Database): Promise<void> {
  const statements = SCHEMA.split(/;\s*(?:\r?\n|$)/)
    .map((part) => part.replace(/--[^\n]*/g, "").trim())
    .filter(Boolean);
  for (const statement of statements) {
    await db.prepare(statement).run();
  }
}
