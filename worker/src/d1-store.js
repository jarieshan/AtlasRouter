import { HttpError } from "./errors.js";

export function database(env) {
  if (!env.DB || typeof env.DB.prepare !== "function" || typeof env.DB.batch !== "function") {
    throw new HttpError(503, "DB D1 binding is not configured");
  }
  // Plain D1 bindings read from the primary. Revocations must not wait for replicas.
  return env.DB;
}

// All identifiers come from storage code, never from request parameters.
// Each statement stays below D1's limit of 100 bound parameters.
export function createWriteBatch(env, scope, expectedVersion, revision = null) {
  const db = database(env);
  const writeId = crypto.randomUUID();
  const guard = "EXISTS (SELECT 1 FROM store_versions WHERE scope = ? AND write_id = ?)";
  const statements = [db.prepare(`
    UPDATE store_versions SET version = version + 1, write_id = ?,
      inventory_revision = COALESCE(?, inventory_revision)
    WHERE scope = ?${expectedVersion === undefined ? "" : " AND version = ?"}
  `).bind(writeId, revision, scope, ...(expectedVersion === undefined ? [] : [expectedVersion]))];

  function eachChunk(columns, rows, sql) {
    const size = Math.floor(98 / columns.length);
    for (let start = 0; start < rows.length; start += size) {
      const chunk = rows.slice(start, start + size);
      const placeholders = chunk.map(() => `(${columns.map(() => "?").join(", ")})`).join(", ");
      const cte = `WITH changes (${columns.join(", ")}) AS (VALUES ${placeholders})`;
      statements.push(db.prepare(`${cte} ${sql}`).bind(
        ...chunk.flatMap((row) => columns.map((column) => row[column])), scope, writeId,
      ));
    }
  }

  return {
    deleteAll(table) {
      statements.push(db.prepare(`DELETE FROM ${table} WHERE ${guard}`).bind(scope, writeId));
    },
    deleteRows(table, keys, rows) {
      const match = keys.map((key) => `changes.${key} = ${table}.${key}`).join(" AND ");
      eachChunk(keys, rows, `DELETE FROM ${table} WHERE EXISTS (SELECT 1 FROM changes WHERE ${match}) AND ${guard}`);
    },
    putRows(table, columns, keys, rows) {
      const updates = columns.filter((column) => !keys.includes(column)).map((column) => `${column} = excluded.${column}`);
      eachChunk(columns, rows, `INSERT INTO ${table} (${columns.join(", ")})
        SELECT ${columns.join(", ")} FROM changes WHERE ${guard}
        ON CONFLICT (${keys.join(", ")}) DO UPDATE SET ${updates.join(", ")}`);
    },
    async commit() {
      // A losing compare-and-swap cannot touch any row: every write checks its
      // unique commit id. D1 rolls the entire batch back if any constraint fails.
      const results = await db.batch(statements);
      return results[0].meta.changes === 1;
    },
  };
}
