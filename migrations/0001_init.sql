-- Atoms Demo: anonymous projects, chat, and every generated code version.
-- Remote: npx wrangler d1 migrations apply atoms-demo --remote
-- Local:  npx wrangler d1 migrations apply atoms-demo --local

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  title TEXT NOT NULL,
  idea TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'idle',
  error TEXT,
  current_version_id TEXT,
  published_slug TEXT,
  published_version_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  role TEXT NOT NULL,
  agent TEXT,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS versions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  number INTEGER NOT NULL,
  html TEXT NOT NULL,
  prompt TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects (owner_id, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_slug ON projects (published_slug);
CREATE INDEX IF NOT EXISTS idx_messages_project ON messages (project_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_versions_number ON versions (project_id, number);
