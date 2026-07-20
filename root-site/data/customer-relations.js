import { buildCustomerGroups } from "./customer-groups.js";

export class CustomerRelationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CustomerRelationError";
    this.code = code;
  }
}

function customerIds(values) {
  return [...new Set((Array.isArray(values) ? values : [values])
    .map((value) => String(value || "").trim())
    .filter(Boolean))];
}

function customerGraph(rows) {
  const byId = new Map();
  const childrenByParent = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = String(row?.id || "").trim();
    if (!id || byId.has(id)) continue;
    const normalized = {
      ...row,
      id,
      parent_id: row?.parent_id == null || row.parent_id === "" ? null : String(row.parent_id)
    };
    byId.set(id, normalized);
    if (normalized.parent_id) {
      const children = childrenByParent.get(normalized.parent_id) ?? [];
      children.push(id);
      childrenByParent.set(normalized.parent_id, children);
    }
  }
  return { byId, childrenByParent };
}

export function expandCustomerDescendants(rows, sourceCustomerIds) {
  const graph = customerGraph(rows);
  const seeds = customerIds(sourceCustomerIds);
  if (!seeds.length) {
    throw new CustomerRelationError("CUSTOMER_SOURCE_REQUIRED", "At least one source customer is required");
  }
  const missing = seeds.filter((id) => !graph.byId.has(id));
  if (missing.length) {
    throw new CustomerRelationError("CUSTOMER_SOURCE_STALE", "One or more source customers no longer exist");
  }

  const expanded = new Set(seeds);
  const queue = seeds.slice();
  for (let index = 0; index < queue.length; index += 1) {
    const parentId = queue[index];
    for (const childId of graph.childrenByParent.get(parentId) ?? []) {
      if (expanded.has(childId)) continue;
      expanded.add(childId);
      queue.push(childId);
    }
  }
  return [...expanded];
}

export function expandCustomerOperationScope(rows, sourceCustomerIds) {
  const graph = customerGraph(rows);
  const seeds = expandCustomerDescendants(rows, sourceCustomerIds);
  const expandedSeeds = new Set(seeds);
  const groups = buildCustomerGroups([...graph.byId.values()]);
  const groupsById = new Map(groups.groups.map((group) => [group.id, group]));

  // A displayed customer may contain several top-level rule-1 records. Refresh
  // that virtual group from the live rows before a destructive write so a stale
  // snapshot cannot leave a newly-matched member behind. A source that is
  // itself already a child still moves only with its own descendants.
  for (const sourceId of seeds) {
    if (graph.byId.get(sourceId)?.parent_id) continue;
    const group = groupsById.get(groups.idToGroup.get(sourceId));
    for (const customerId of group?.allCids ?? [sourceId]) expandedSeeds.add(customerId);
  }
  return expandCustomerDescendants(rows, [...expandedSeeds]);
}

export function planCustomerMerge(rows, sourceCustomerIds, keeperCustomerId) {
  const graph = customerGraph(rows);
  const keeperId = String(keeperCustomerId || "").trim();
  const keeper = graph.byId.get(keeperId);
  if (!keeper) {
    throw new CustomerRelationError("CUSTOMER_KEEPER_STALE", "The target customer no longer exists");
  }
  if (keeper.parent_id) {
    throw new CustomerRelationError("CUSTOMER_KEEPER_NOT_ROOT", "The target customer must be a top-level record");
  }

  const sourceIds = expandCustomerOperationScope(rows, sourceCustomerIds);
  const sourceSet = new Set(sourceIds);
  if (sourceSet.has(keeperId)) {
    throw new CustomerRelationError("CUSTOMER_MERGE_CYCLE", "The target customer belongs to the source relationship tree");
  }

  // Defensive ancestor walk: the top-level requirement normally makes this a
  // single step, but keep the cycle check explicit for malformed legacy rows.
  const visited = new Set();
  let cursor = keeper;
  while (cursor?.parent_id) {
    if (sourceSet.has(cursor.parent_id) || visited.has(cursor.parent_id)) {
      throw new CustomerRelationError("CUSTOMER_MERGE_CYCLE", "The merge would create a customer relationship cycle");
    }
    visited.add(cursor.parent_id);
    cursor = graph.byId.get(cursor.parent_id);
  }

  return { keeperId, sourceIds };
}
