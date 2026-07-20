import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const monitor = await readFile(new URL("../root-site/bizflow/ocpp-monitor.js", import.meta.url), "utf8");

assert.match(monitor, /const OCPP_AUTO_REFRESH_INTERVAL_MS = 30_000;/,
  "OCPP monitor must retain the approved 30-second polling cadence");
assert.match(monitor, /autoRefresh: typeof saved\.autoRefresh === "boolean" \? saved\.autoRefresh : true/,
  "auto refresh must default on while preserving an explicit captured off state");
assert.match(monitor, /activeScope\.timeout\(async \(\) => \{[^]*await refreshMonitorData\(\);[^]*scheduleAutoRefresh\(\);[^]*OCPP_AUTO_REFRESH_INTERVAL_MS/,
  "polling must be lifecycle-scoped and recursively scheduled after each refresh");
assert.match(monitor, /if \(state\.autoRefresh\) void refreshMonitorData\(\);[^]*scheduleAutoRefresh\(\);/,
  "turning polling on must refresh immediately and start the timer");
assert.match(monitor, /logs: preserveDeferredLogs \? data\.logs : result\.logs/,
  "the lightweight status poll must not discard already-loaded deferred OCPP logs");
assert.match(monitor, /dispose\(\) \{[^]*cancelAutoRefresh\(\);/,
  "SPA disposal must cancel the pending OCPP poll");

console.log("Empty-shell batch 4 contracts: PASS (OCPP 30s lifecycle polling)");
