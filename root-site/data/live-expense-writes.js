import { getCurrentUser, getSession, getSupabaseClient } from "./auth.js";
import { invalidateLiveTables } from "./live-snapshot-utils.js";

async function writeContext() {
  const [client, session, currentUser] = await Promise.all([
    getSupabaseClient(),
    getSession(),
    getCurrentUser()
  ]);
  if (!client || !session?.user || !currentUser?.employeeId) {
    throw new Error("Authenticated expense write context required");
  }
  return { client, currentUser };
}

function throwIfError(error) {
  if (error) throw error;
}

async function uploadReceipt(client, employeeId, file) {
  const extension = (String(file.name || "").split(".").pop() || "bin").toLowerCase();
  const path = `${employeeId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;
  const upload = await client.storage.from("expense-receipts").upload(path, file, {
    contentType: file.type || "application/octet-stream",
    upsert: false
  });
  throwIfError(upload.error);
  return {
    path,
    url: client.storage.from("expense-receipts").getPublicUrl(path).data.publicUrl
  };
}

export async function createLiveExpense({ date, amount, currency, category, description, files = [] }) {
  const { client, currentUser } = await writeContext();
  const uploaded = [];
  try {
    for (const file of files) uploaded.push(await uploadReceipt(client, currentUser.employeeId, file));
    const result = await client.from("expense_reimbursements").insert({
      employee_id: currentUser.employeeId,
      expense_date: date,
      amount,
      currency,
      category,
      description: description || null,
      receipt_urls: uploaded.map((receipt) => receipt.url)
    }).select("*").single();
    throwIfError(result.error);
    await invalidateLiveTables("expense_reimbursements");
    return { row: result.data, receiptPaths: uploaded.map((receipt) => receipt.path) };
  } catch (error) {
    if (uploaded.length) {
      await client.storage.from("expense-receipts").remove(uploaded.map((receipt) => receipt.path));
    }
    throw error;
  }
}

async function updateExpenseRow(client, expenseId, patch, constrain = (query) => query) {
  const query = constrain(client.from("expense_reimbursements").update(patch).eq("id", expenseId));
  const result = await query.select("*").single();
  throwIfError(result.error);
  await invalidateLiveTables("expense_reimbursements");
  return result.data;
}

export async function approveLiveExpense(expenseId) {
  const { client, currentUser } = await writeContext();
  const reviewedAt = new Date().toISOString();
  return updateExpenseRow(client, expenseId, {
    status: "approved",
    reviewed_by: currentUser.employeeId,
    reviewed_at: reviewedAt,
    reject_reason: null,
    paid: false,
    paid_at: null
  }, (query) => query.eq("status", "pending"));
}

export async function rejectLiveExpense(expenseId, rejectReason = "") {
  const { client, currentUser } = await writeContext();
  const reviewedAt = new Date().toISOString();
  return updateExpenseRow(client, expenseId, {
    status: "rejected",
    reviewed_by: currentUser.employeeId,
    reviewed_at: reviewedAt,
    reject_reason: String(rejectReason || "").trim() || null,
    paid: false,
    paid_at: null
  }, (query) => query.eq("status", "pending"));
}

export async function markLiveExpensePaid(expenseId) {
  const { client } = await writeContext();
  return updateExpenseRow(client, expenseId, {
    paid: true,
    paid_at: new Date().toISOString()
  }, (query) => query.eq("status", "approved").eq("paid", false));
}

export async function deleteLiveExpense(expenseId) {
  const { client } = await writeContext();
  const result = await client.from("expense_reimbursements")
    .delete()
    .eq("id", expenseId)
    .select("id")
    .single();
  throwIfError(result.error);
  await invalidateLiveTables("expense_reimbursements");
  return result.data;
}
