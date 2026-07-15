import { getCurrentUser, getSession, getSupabaseClient } from "./auth.js";
import { invalidateLiveAuthCache } from "./live-table-cache.js";

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
    await invalidateLiveAuthCache();
    return { row: result.data, receiptPaths: uploaded.map((receipt) => receipt.path) };
  } catch (error) {
    if (uploaded.length) {
      await client.storage.from("expense-receipts").remove(uploaded.map((receipt) => receipt.path));
    }
    throw error;
  }
}
