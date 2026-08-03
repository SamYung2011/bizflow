export const expenseFilters = ["pending", "approved", "rejected", "paid", "mine", "all"];
export const expenseCurrencies = ["RMB", "HKD", "USD"];
export const expenseCategories = ["Food", "Transport", "Office", "Material", "Communication", "Other"];
export const expenseCategoryDbValues = {
  Food: "餐飲",
  Transport: "交通",
  Office: "辦公",
  Material: "物料",
  Communication: "通訊",
  Other: "其他"
};
export const expenseCategoryKeys = {
  Food: "categoryFood",
  Transport: "categoryTransport",
  Office: "categoryOffice",
  Material: "categoryMaterial",
  Communication: "categoryCommunication",
  Other: "categoryOther"
};

const expenseCategoryByDbValue = Object.fromEntries(
  Object.entries(expenseCategoryDbValues).map(([key, value]) => [value, key])
);

export function normalizeExpenseRows(items) {
  return items.map((item, index) => ({
    id: String(item.id ?? `snapshot-expense-${index + 1}`),
    employeeId: String(item.employeeId ?? item.employee_id ?? ""),
    employee: String(item.employee ?? item.employeeName ?? item.employee_name ?? "—"),
    date: String(item.date ?? item.expenseDate ?? item.expense_date ?? ""),
    currency: expenseCurrencies.includes(item.currency) ? item.currency : "RMB",
    amount: Number(item.amount) || 0,
    category: expenseCategoryByDbValue[item.category] ?? (expenseCategories.includes(item.category) ? item.category : "Other"),
    description: String(item.description || ""),
    receipts: Array.isArray(item.receiptUrls ?? item.receipt_urls)
      ? (item.receiptUrls ?? item.receipt_urls).map((url) => ({ url: String(url), name: "" }))
      : [],
    status: ["pending", "approved", "rejected"].includes(item.status) ? item.status : "pending",
    paid: item.paid === true,
    paidAt: String(item.paidAt ?? item.paid_at ?? ""),
    rejectReason: String(item.rejectReason ?? item.reject_reason ?? ""),
    local: item.local === true
  }));
}

export function expenseCounts(rows, ownerKey) {
  const result = { pending: 0, approved: 0, rejected: 0, paid: 0, mine: 0, all: rows.length };
  rows.forEach((row) => {
    if (result[row.status] !== undefined) result[row.status] += 1;
    if (row.paid) result.paid += 1;
    if (row.employeeId === ownerKey) result.mine += 1;
  });
  return result;
}

export function filterExpenseRows(rows, filter, ownerKey) {
  if (filter === "all") return rows;
  if (filter === "paid") return rows.filter((row) => row.paid);
  if (filter === "mine") return rows.filter((row) => row.employeeId === ownerKey);
  return rows.filter((row) => row.status === filter);
}
