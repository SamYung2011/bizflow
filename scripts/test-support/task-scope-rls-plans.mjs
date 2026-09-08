import assert from "node:assert/strict";

export function checkSetPlan(plan, label, maximum) {
  const producers = [];
  function visit(node) {
    if (["ProjectSet", "Function Scan"].includes(node["Node Type"])
      && (node["Function Name"] === "bizflow_visible_task_ids"
        || node.Output?.some((value) => value.includes("bizflow_visible_task_ids")))) producers.push(node);
    (node.Plans || []).forEach(visit);
  }
  visit(plan);
  assert.ok(producers.length > 0 && producers.length <= maximum,
    `${label}: set-producing nodes ${producers.length} must be in 1..${maximum}`);
  for (const node of producers) assert.equal(node["Actual Loops"], 1, `${label}: each set producer must run once`);
  console.log(`SET_PLAN_${label}=${JSON.stringify({ nodes: producers.length, maximum,
    loops: producers.map((node) => node["Actual Loops"]), rows: producers.map((node) => node["Actual Rows"]) })}`);
}

export function normalizePayload(payload) {
  const { generatedAt, ...rest } = payload;
  // The fixture gives rows equal timestamps; compare full rows without assuming tie order.
  return Object.fromEntries(Object.entries(rest).map(([key, value]) => [key,
    Array.isArray(value) ? [...value].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) : value]));
}

export function explainRpc(query, uid, statement) {
  // Plain EXPLAIN cannot see through 111's SET search_path function boundary.
  // auto_explain captures the actual nested SQL plan without changing any function body.
  const result = query(`LOAD 'auto_explain';
    SET client_min_messages=log;
    SET auto_explain.log_min_duration=0;
    SET auto_explain.log_analyze=on;
    SET auto_explain.log_verbose=on;
    SET auto_explain.log_nested_statements=on;
    SET auto_explain.log_format=json;
    BEGIN; SET LOCAL ROLE authenticated;
    SET LOCAL request.jwt.claim.sub='${uid}';
    SET LOCAL statement_timeout='8s';
    ${statement} ROLLBACK;`);
  const allPlans = [...result.stderr.matchAll(/plan:\n(\{[^]*?\n\})/g)].map((match) => JSON.parse(match[1]));
  const plans = allPlans.filter((plan) => plan["Query Text"]?.includes("assignee_rows AS MATERIALIZED"));
  console.log(`RPC_111_NESTED_PLANS=${plans.length}; AUTO_EXPLAIN_TOTAL=${allPlans.length}`);
  console.log(`RPC_111_PLAN_JSON=${JSON.stringify(plans)}`);
  return { payload: JSON.parse(result.stdout.trim()), plans };
}
