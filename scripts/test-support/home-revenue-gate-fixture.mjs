import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

function extractMaterializedCte(sql, name) {
  const marker = `${name} AS MATERIALIZED`;
  const markerIndex = sql.indexOf(marker);
  assert.notEqual(markerIndex, -1, `missing ${name} materialized CTE`);
  const opening = sql.indexOf("(", markerIndex + marker.length);
  assert.notEqual(opening, -1, `missing ${name} CTE body`);

  let depth = 0;
  let quote = "";
  for (let index = opening; index < sql.length; index += 1) {
    const char = sql[index];
    const next = sql[index + 1];
    if (quote) {
      if (char === quote) {
        if (next === quote) index += 1;
        else quote = "";
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === "(") depth += 1;
    if (char === ")") {
      depth -= 1;
      if (depth === 0) return sql.slice(opening + 1, index);
    }
  }
  assert.fail(`unterminated ${name} CTE body`);
}

export function assertHomeRevenueGateBehavior(migrationSql) {
  const gateSql = extractMaterializedCte(migrationSql, "revenue_access")
    .replaceAll("public.employees", "employees")
    .replaceAll("auth.uid()", "current_user_id()");
  const database = new DatabaseSync(":memory:");
  let currentUserId = "";
  try {
    database.function("current_user_id", () => currentUserId);
    database.exec(`
      CREATE TABLE employees (
        user_id TEXT NOT NULL,
        is_admin INTEGER NOT NULL,
        can_view_revenue INTEGER NOT NULL
      );
    `);
    const insert = database.prepare(
      "INSERT INTO employees(user_id, is_admin, can_view_revenue) VALUES (?, ?, ?)"
    );
    insert.run("revenue-denied", 0, 0);
    insert.run("revenue-allowed", 0, 1);
    insert.run("admin-allowed", 1, 0);
    const evaluate = database.prepare(`
      WITH revenue_access AS MATERIALIZED (${gateSql})
      SELECT allowed FROM revenue_access
    `);
    const allowedFor = (userId) => {
      currentUserId = userId;
      return Boolean(evaluate.get()?.allowed);
    };

    assert.equal(allowedFor("revenue-denied"), false,
      "Home revenue gate behavior: a denied employee must not receive revenue access");
    assert.equal(allowedFor("missing-employee"), false,
      "Home revenue gate behavior: an unknown user must not receive revenue access");
    assert.equal(allowedFor("revenue-allowed"), true,
      "Home revenue gate behavior: can_view_revenue must grant access");
    assert.equal(allowedFor("admin-allowed"), true,
      "Home revenue gate behavior: is_admin must grant access");
  } finally {
    database.close();
  }
}
