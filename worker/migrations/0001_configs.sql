CREATE TABLE IF NOT EXISTS configs (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL CHECK (json_valid(value)),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1)
);
