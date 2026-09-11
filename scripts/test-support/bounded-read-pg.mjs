import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Isolated Unix-socket PostgreSQL only; never consumes connection env vars.
export function createBoundedReadPg(repoRoot) {
  const root = mkdtempSync(join(tmpdir(), "bizflow-bounded-read-"));
  const data = join(root, "data"), socket = join(root, "socket");
  mkdirSync(socket);
  const run = (name, args, input) => {
    const result = spawnSync(`/opt/homebrew/bin/${name}`, args, { input, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    if (result.status !== 0) throw new Error(`${name}: ${result.stderr}\n${result.stdout}`);
    return result.stdout.trim();
  };
  let started = false;
  const sql = (statement) => run("psql", ["-X", "-qAt", "-h", socket, "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose"], statement);
  const close = () => {
    if (started) run("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"]);
    started = false; rmSync(root, { recursive: true, force: true });
  };
  try {
    run("initdb", ["-D", data, "-A", "trust", "--no-locale", "--encoding=UTF8"]);
    run("pg_ctl", ["-D", data, "-l", join(root,"pg.log"), "-o", `-k ${socket} -c listen_addresses=''`, "-w", "start"]);
    started = true;
    sql(readFileSync(new URL("./bounded-read-schema.sql", import.meta.url), "utf8"));
    for (const file of ["102_bizflow_data_phase1.sql", "103_guard_non_array_invoice_items.sql", "104_bizflow_data_phase1_r5.sql", "105_bizflow_warranty_revenue_gate.sql", "106_bizflow_home_revenue_gate.sql", "107_bizflow_home_sales_gate.sql", "108_bizflow_customer_page.sql"]) {
      sql(readFileSync(join(repoRoot,"migrations",file), "utf8"));
    }
  } catch (error) { close(); throw error; }
  const asUser = (statement, userId = "20000000-0000-0000-0000-000000000001") => sql(`SET ROLE authenticated; SET request.jwt.claim.sub='${userId}'; SET statement_timeout='20s'; ${statement}`);
  return { sql, asUser, close };
}
