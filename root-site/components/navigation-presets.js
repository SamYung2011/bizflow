import { consumeSessionValue, setSessionValue } from "../data/session-state.js";

export const navigationPresetKeys = Object.freeze({
  ordersTab: "task-platform.orders.initialTab",
  ordersShipping: "task-platform.orders.initialShipping",
  ordersSearch: "task-platform.orders.initialSearch",
  inventorySearch: "task-platform.inventory.initialSearch",
  customersTab: "task-platform.customers.initialTab",
  warrantySearch: "task-platform.customers.initialWarrantySearch"
});

const allowedPresetKeys = new Set(Object.values(navigationPresetKeys));

export function setNavigationPreset(key, value) {
  if (!allowedPresetKeys.has(key) || value === null || value === undefined || value === "") return;
  setSessionValue(key, String(value));
}

export function consumeNavigationPreset(key) {
  if (!allowedPresetKeys.has(key)) return null;
  return consumeSessionValue(key);
}
