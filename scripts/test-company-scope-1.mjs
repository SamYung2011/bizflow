import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  COMPANY_SCOPED_SNAPSHOTS,
  isCompanyScopedSnapshot
} from "../root-site/data/live-snapshot-dependencies.js";
import {
  invalidateLiveSnapshotCache,
  LIVE_SNAPSHOT_CACHE_TTL_MS,
  readLiveSnapshotCache,
  writeLiveSnapshotCache
} from "../root-site/data/live-table-cache.js";

const read = (relative) => readFile(new URL(`../${relative}`, import.meta.url), "utf8");
const [tableCache, snapshots, authSource, dependencies] = await Promise.all([
  read("root-site/data/live-table-cache.js"),
  read("root-site/data/live-snapshots.js"),
  read("root-site/data/auth.js"),
  read("root-site/data/live-snapshot-dependencies.js")
]);

// ---------------------------------------------------------------------------
// Runtime: switching company must isolate the persisted snapshot entry at once.
// Round-A (2026-08-04) saw members.json keep serving the previous company for a
// full 10-minute TTL plus one reload because the key only carried the user id.
// ---------------------------------------------------------------------------
const userId = "user-round-a";
const companyA = "company-honnmono";
const companyB = "company-driveez";

for (const snapshot of COMPANY_SCOPED_SNAPSHOTS) {
  const valueA = { scope: companyA, members: ["a1", "a2"] };
  const valueB = { scope: companyB, members: ["b1"] };

  // Entries cached before this fix carry no company id; a scoped read must never reuse them.
  assert.equal(await writeLiveSnapshotCache({ userId, snapshot, value: { members: ["legacy"] } }), true);
  assert.equal(await readLiveSnapshotCache({ userId, snapshot, companyId: companyA }), null,
    `${snapshot} pre-fix entries must not leak into a company-scoped read`);
  assert.deepEqual((await readLiveSnapshotCache({ userId, snapshot }))?.value, { members: ["legacy"] });

  assert.equal(await writeLiveSnapshotCache({ userId, snapshot, companyId: companyA, value: valueA }), true,
    `${snapshot} must cache under the active company`);
  assert.deepEqual((await readLiveSnapshotCache({ userId, snapshot, companyId: companyA }))?.value, valueA,
    `${snapshot} must stay readable for the company it was built for`);
  assert.equal(await readLiveSnapshotCache({ userId, snapshot, companyId: companyB }), null,
    `${snapshot} must miss immediately after a company switch instead of serving the previous company`);

  assert.equal(await writeLiveSnapshotCache({ userId, snapshot, companyId: companyB, value: valueB }), true);
  assert.deepEqual((await readLiveSnapshotCache({ userId, snapshot, companyId: companyB }))?.value, valueB,
    `${snapshot} must serve the switched company its own rows`);
  assert.deepEqual((await readLiveSnapshotCache({ userId, snapshot, companyId: companyA }))?.value, valueA,
    `${snapshot} must keep both companies side by side so switching back stays warm`);

  // A data write still has to refresh every company, not just the active one.
  await invalidateLiveSnapshotCache(snapshot);
  for (const companyId of [companyA, companyB, ""]) {
    assert.equal(await readLiveSnapshotCache({ userId, snapshot, companyId }), null,
      `${snapshot} invalidation must evict every company's entry`);
  }
}

assert.deepEqual([...COMPANY_SCOPED_SNAPSHOTS], ["home.json", "members.json", "tasks.json"]);
for (const snapshot of ["orders.json", "customers.json", "team-extras.json", "inventory.json", "warranty.json"]) {
  assert.equal(isCompanyScopedSnapshot(snapshot), false,
    `${snapshot} is RLS-scoped, not company-filtered, and must not pay for a company cache key`);
}
assert.equal(LIVE_SNAPSHOT_CACHE_TTL_MS, 10 * 60_000,
  "the company scope fix must not paper over the gap by shortening the approved snapshot TTL");

// ---------------------------------------------------------------------------
// Source: every builder that filters by activeCompanyId must be declared scoped.
// ---------------------------------------------------------------------------
const snapshotCode = snapshots.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const declarations = [...snapshotCode.matchAll(/\basync function ([A-Za-z0-9_]+)\s*\(/g)]
  .map((match) => ({ name: match[1], index: match.index }));
const enclosingFunction = (index) =>
  declarations.filter((declaration) => declaration.index <= index).at(-1)?.name ?? "";
const companyFilteringFunctions = new Set(
  [...snapshotCode.matchAll(/activeCompanyId/g)].map((match) => enclosingFunction(match.index))
);
assert.deepEqual([...companyFilteringFunctions].sort(),
  ["buildTasksSnapshot", "memberSourceData", "snapshotCompanyId"],
  "a new company-filtered builder must be added to COMPANY_SCOPED_SNAPSHOTS before it can cache");
assert.match(snapshots, /async function buildHomeSnapshot\(\)[\s\S]*?buildTasksSnapshot\(\)[\s\S]*?buildMembersSnapshot\(\)/,
  "home.json stays company scoped because it embeds the tasks and members builders");
assert.match(dependencies, /export const COMPANY_SCOPED_SNAPSHOTS = Object\.freeze\(\[/,
  "the scoped snapshot list must stay a single frozen source shared by auth and the cache");

assert.match(snapshots, /async function snapshotCompanyId\(snapshot\) \{\s*if \(!isCompanyScopedSnapshot\(snapshot\)\) return "";\s*return String\(\(await getCurrentUser\(\)\)\?\.activeCompanyId \|\| ""\);/,
  "the cache key must come from the same activeCompanyId the builders filter on");
assert.match(snapshots, /async function loadLiveSnapshot\(snapshot, builder, userId\) \{\s*const companyId = await snapshotCompanyId\(snapshot\);\s*const cached = await readLiveSnapshotCache\(\{ userId, snapshot, companyId \}\);/,
  "the company scope must be resolved before the cached entry is read, not after");
assert.match(snapshots, /refreshLiveSnapshot\(snapshot, builder, userId, companyId, value\)/,
  "a stale-while-revalidate rebuild must write back under the same company");
assert.match(snapshots, /writeLiveSnapshotCache\(\{ userId, snapshot, companyId, value, version \}\)/,
  "every snapshot write must carry its company scope");

// ---------------------------------------------------------------------------
// Source: cache key + payload guard, and the switch-time refresh signal.
// ---------------------------------------------------------------------------
assert.match(tableCache, /function snapshotCacheKey\(userId, snapshot, companyId\) \{[\s\S]*?const scope = companyId \? `:\$\{encoded\(companyId\)\}` : "";[\s\S]*?\$\{encoded\(userId\)\}:\$\{encoded\(snapshot\)\}\$\{scope\}/,
  "snapshot cache keys must carry the company id after the userId:snapshot prefix");
assert.match(tableCache, /function parseSnapshotPayload\(value, expectedUserId, expectedSnapshot, expectedCompanyId\)[\s\S]*?String\(payload\.companyId \|\| ""\) !== expectedCompanyId/,
  "a payload from another company must be rejected even if a key ever collides");
assert.match(tableCache, /snapshot: normalizedSnapshot,\s*companyId: normalizedCompanyId,/,
  "stored snapshot payloads must record the company they were built for");
assert.match(tableCache, /export async function invalidateLiveSnapshotCache[\s\S]*?removeIndexedSnapshots\(targets\)/,
  "table-driven invalidation must keep evicting a snapshot across every company");

const switchBody = authSource.slice(authSource.indexOf("export async function setActiveCompany"));
assert.match(switchBody, /safeLocalStorageSet\(`team-active-company-\$\{context\.userId \|\| context\.employeeId\}`, nextCompanyId\);[\s\S]*?clearCurrentUserMemory\(\);[\s\S]*?await invalidateLiveAuthCache\(\);[\s\S]*?const nextContext = await getCurrentUser\(\);\s*notifyCompanyScopeChange\(\);/,
  "a company switch must rebuild the auth context first, then announce the new company scope");
assert.match(authSource, /function notifyCompanyScopeChange\(\)[\s\S]*?snapshots: \[\.\.\.COMPANY_SCOPED_SNAPSHOTS\][\s\S]*?LIVE_SNAPSHOT_INVALIDATED_EVENT[\s\S]*?LIVE_SNAPSHOT_UPDATED_EVENT/,
  "a switch must drop the in-page snapshot memos and then let mounted pages rebuild");

console.log("COMPANY-scope-1 contracts: PASS (per-company snapshot keys, payload guard, switch-time refresh)");
