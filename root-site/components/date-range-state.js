import { normalizeDateInput } from "./date-value.js";

export function restoredQueryRange(value = {}) {
  const start = normalizeDateInput(value?.start ?? value?.from);
  const end = normalizeDateInput(value?.endDateEnabled === false && start ? start : value?.end ?? value?.to);
  return start && end && start > end ? { from: end, to: start } : { from: start, to: end };
}
