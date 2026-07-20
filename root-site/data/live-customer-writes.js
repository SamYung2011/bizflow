import { getCurrentUser, getSession, getSupabaseClient } from "./auth.js";
import { expandCustomerOperationScope, planCustomerMerge } from "./customer-relations.js";
import { invalidateLiveTables } from "./live-snapshot-utils.js";

const READ_PAGE_SIZE = 1000;

export class CustomerDeleteBlockedError extends Error {
  constructor(invoiceCount) {
    super("Customer has related invoices");
    this.name = "CustomerDeleteBlockedError";
    this.code = "CUSTOMER_HAS_INVOICES";
    this.invoiceCount = Number(invoiceCount) || 0;
  }
}

async function customerWriteContext() {
  const [client, session, currentUser] = await Promise.all([
    getSupabaseClient(),
    getSession(),
    getCurrentUser()
  ]);
  if (!client || !session?.user || currentUser?.bizflowMainAccess !== true) {
    throw new Error("Authenticated customer write context required");
  }
  return { client };
}

function throwIfError(error) {
  if (error) throw error;
}

async function readCustomerGraph(client) {
  const rows = [];
  for (let from = 0; ; from += READ_PAGE_SIZE) {
    const result = await client.from("customers")
      .select("id,parent_id,merge_exclude,name,phone,phone_mainland,email,address")
      .order("id", { ascending: true })
      .range(from, from + READ_PAGE_SIZE - 1);
    throwIfError(result.error);
    const page = result.data ?? [];
    rows.push(...page);
    if (page.length < READ_PAGE_SIZE) return rows;
  }
}

function chunks(values, size = 100) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

async function countRelatedInvoices(client, customerIds) {
  let total = 0;
  // Deliberately use paginated GETs. Authenticated count-HEAD is known to fail
  // on this deployment, and a single default-sized GET could undercount.
  for (const ids of chunks(customerIds)) {
    for (let from = 0; ; from += READ_PAGE_SIZE) {
      const result = await client.from("invoices")
        .select("id")
        .in("customer_id", ids)
        .order("id", { ascending: true })
        .range(from, from + READ_PAGE_SIZE - 1);
      throwIfError(result.error);
      const page = result.data ?? [];
      total += page.length;
      if (page.length < READ_PAGE_SIZE) break;
    }
  }
  return total;
}

async function currentDeletePlan(client, sourceCustomerIds) {
  const graphRows = await readCustomerGraph(client);
  const customerIds = expandCustomerOperationScope(graphRows, sourceCustomerIds);
  const invoiceCount = await countRelatedInvoices(client, customerIds);
  return { customerIds, invoiceCount };
}

export async function prepareLiveCustomerDeletion(sourceCustomerIds) {
  const { client } = await customerWriteContext();
  return currentDeletePlan(client, sourceCustomerIds);
}

export async function deleteLiveCustomerGroup(sourceCustomerIds) {
  const { client } = await customerWriteContext();
  // Rebuild both the relationship closure and invoice guard immediately before
  // deletion so a stale modal can never bypass a newly-created invoice.
  const plan = await currentDeletePlan(client, sourceCustomerIds);
  if (plan.invoiceCount > 0) throw new CustomerDeleteBlockedError(plan.invoiceCount);

  const result = await client.from("customers")
    .delete()
    .in("id", plan.customerIds)
    .select("id");
  throwIfError(result.error);
  if ((result.data ?? []).length !== plan.customerIds.length) {
    throw new Error("Customer deletion did not affect the complete relationship group");
  }
  await invalidateLiveTables("customers", "customer_devices", "adapter_charge_log", "charger_leads");
  return { deletedCustomerIds: plan.customerIds };
}

export async function mergeLiveCustomerGroup({ sourceCustomerIds, keeperCustomerId }) {
  const { client } = await customerWriteContext();
  const graphRows = await readCustomerGraph(client);
  const plan = planCustomerMerge(graphRows, sourceCustomerIds, keeperCustomerId);

  // One PostgREST UPDATE keeps the entire re-parent operation atomic: every
  // current virtual-group root and transitive descendant becomes a direct child.
  const result = await client.from("customers")
    .update({ parent_id: plan.keeperId, merge_exclude: [] })
    .in("id", plan.sourceIds)
    .select("id,parent_id");
  throwIfError(result.error);
  if ((result.data ?? []).length !== plan.sourceIds.length) {
    throw new Error("Customer merge did not affect the complete relationship group");
  }
  await invalidateLiveTables("customers");
  return { keeperCustomerId: plan.keeperId, mergedCustomerIds: plan.sourceIds };
}
