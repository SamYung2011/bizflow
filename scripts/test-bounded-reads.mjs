import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const pg = process.argv.includes("--pg");
const directory = fileURLToPath(new URL("./", import.meta.url));
const pattern = pg ? /^test-.*-bounded-pg\.mjs$/ : /^test-.*-bounded\.mjs$/;
const tests = readdirSync(directory).filter(name => pattern.test(name)).sort();
if (!tests.length) throw new Error("No bounded-read tests found");
for (const test of tests) {
  const result = spawnSync(process.execPath, [directory + test], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`BOUNDED_READ_SUITES=${tests.length}/${tests.length}`);
