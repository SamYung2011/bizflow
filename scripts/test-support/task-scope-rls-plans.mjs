import assert from "node:assert/strict";

export function normalizePayload(payload) {
  const { generatedAt, ...rest } = payload;
  // Keep all array ordering and unread values. Fixture row timestamps are fixed.
  return rest;
}

export function assertLegacyPlan(plan, label) {
  const serialized = JSON.stringify(plan);
  assert.doesNotMatch(serialized, /bizflow_visible_task_ids|bizflow_scoped_task_/,
    `${label}: single-row policy must not calculate a task set`);
  assert.match(serialized, /can_select_employee_task_by_id/);
  console.log(`LEGACY_SINGLE_ROW_PLAN_${label}=${serialized}`);
  console.log(`LEGACY_SINGLE_ROW_${label}=visible_set_nodes:0`);
}
