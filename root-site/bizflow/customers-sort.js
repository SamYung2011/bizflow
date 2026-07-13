export const customerSortKeys = ["createdDesc", "createdAsc", "lastPurchaseDesc", "lastPurchaseAsc"];

function numericDate(value) {
  const time = Date.parse(String(value || "").replaceAll("/", "-"));
  return Number.isFinite(time) ? time : null;
}

export function createCustomerSorter() {
  const timesById = new Map();

  function timesFor(customer) {
    if (timesById.has(customer.id)) return timesById.get(customer.id);
    const times = {
      createdTime: numericDate(customer.joinedAt),
      lastPurchaseTime: (customer.detail?.orders ?? []).reduce((latest, order) => {
        const time = numericDate(order.date);
        return time == null ? latest : Math.max(latest ?? time, time);
      }, null)
    };
    timesById.set(customer.id, times);
    return times;
  }

  function timeFor(customer, sort) {
    return timesFor(customer)[sort.startsWith("lastPurchase") ? "lastPurchaseTime" : "createdTime"];
  }

  function compare(left, right, sort) {
    const leftTime = timeFor(left, sort);
    const rightTime = timeFor(right, sort);
    // Mirrors bizflow_samyung/src/views/Customers.jsx:601-603: missing values always sink.
    if (leftTime == null && rightTime == null) return 0;
    if (leftTime == null) return 1;
    if (rightTime == null) return -1;
    return sort.endsWith("Desc") ? rightTime - leftTime : leftTime - rightTime;
  }

  return { compare, timeFor };
}
