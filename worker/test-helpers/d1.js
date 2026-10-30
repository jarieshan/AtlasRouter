import { DatabaseSync } from "node:sqlite";
import { after } from "node:test";
import { migrations } from "./migrations.js";

const databases = [];
after(() => databases.forEach((db) => db.close()));

// Execute the production SQL against SQLite; runtime tests also exercise D1 itself.
export function createD1Env(config = null, subscriptions = null) {
  const sqlite = new DatabaseSync(":memory:");
  databases.push(sqlite);
  sqlite.exec("PRAGMA foreign_keys = ON");
  sqlite.exec(migrations[0].sql);
  if (config !== null) sqlite.prepare("INSERT INTO configs (key, value) VALUES (?, ?)").run("router-config", JSON.stringify(config));
  if (subscriptions !== null) sqlite.prepare("INSERT INTO configs (key, value) VALUES (?, ?)").run("subscriptions", JSON.stringify(subscriptions));
  for (const migration of migrations.slice(1)) {
    sqlite.exec("BEGIN");
    try {
      sqlite.exec(migration.sql);
      sqlite.exec("COMMIT");
    } catch (error) {
      sqlite.exec("ROLLBACK");
      throw error;
    }
  }
  const env = {
    writeCount: 0,
    DB: {
      prepare: statement,
      async batch(statements) {
        sqlite.exec("BEGIN");
        try {
          const results = statements.map((item) => item.execute());
          sqlite.exec("COMMIT");
          env.writeCount += results.reduce((sum, result) => sum + result.meta.changes, 0);
          return results;
        } catch (error) {
          sqlite.exec("ROLLBACK");
          throw error;
        }
      },
    },
  };
  function statement(sql, values = []) {
    return {
      bind(...params) {
        if (params.length > 100) throw new Error("D1 statement exceeds 100 bound parameters");
        return statement(sql, params);
      },
      execute() {
        const prepared = sqlite.prepare(sql);
        const query = prepared.columns().length > 0;
        const results = query ? prepared.all(...values) : [];
        const changes = query ? 0 : Number(prepared.run(...values).changes);
        return { success: true, results, meta: { changes } };
      },
      async first() { return sqlite.prepare(sql).get(...values) ?? null; },
      async all() { return this.execute(); },
      async run() {
        const result = this.execute();
        env.writeCount += result.meta.changes;
        return result;
      },
    };
  }
  return env;
}
