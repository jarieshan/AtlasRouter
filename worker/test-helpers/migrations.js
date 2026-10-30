import { readFileSync, readdirSync } from "node:fs";

const directory = new URL("../migrations/", import.meta.url);
export const migrations = readdirSync(directory).filter((name) => name.endsWith(".sql")).sort().map((name) => ({
  name, sql: readFileSync(new URL(name, directory), "utf8"),
}));

export async function applyMigrations(db, available = migrations) {
  await db.prepare("CREATE TABLE IF NOT EXISTS d1_migrations (name TEXT PRIMARY KEY)").run();
  const { results } = await db.prepare("SELECT name FROM d1_migrations").all();
  const applied = new Set(results.map((row) => row.name));
  for (const migration of available) {
    if (applied.has(migration.name)) continue;
    // These migrations contain ordinary SQL statements, without trigger bodies.
    const statements = migration.sql.split(/;\s*(?:\n|$)/).filter((sql) => sql.trim()).map((sql) => db.prepare(sql));
    await db.batch([...statements, db.prepare("INSERT INTO d1_migrations (name) VALUES (?)").bind(migration.name)]);
  }
}
