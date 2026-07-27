import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  createOcppCommandClient,
  OCPP_PHASE1_COMMANDS,
} from "../root-site/data/live-ocpp-commands.js";
import {
  canCancelOcppSchedule,
  defaultOcppScheduleLocalValue,
  getOcppCommandAvailability,
  isFutureOcppSchedule,
  mergeOcppCommandRows,
  normalizeOcppSchedules,
  normalizeOcppStatusRows,
  parseOcppTransactionId,
} from "../root-site/bizflow/ocpp-command-model.js";
import { translateOcppCommand } from "../root-site/bizflow/ocpp-command-copy.js";
import { renderOcppCommandStatus } from "../root-site/bizflow/ocpp-command-view.js";

function jsonResponse(value, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    text: async () => JSON.stringify(value),
  };
}

const calls = [];
const fakeRequest = async (url, init) => {
  calls.push({ url, init });
  if (url.endsWith("/status")) {
    return jsonResponse([
      {
        ChargePointId: "troy",
        OnlineConnectors: {
          1: { Status: "Charging", TransactionId: null },
        },
      },
    ]);
  }
  if (url.endsWith("/schedule") && init.method === "GET") {
    return jsonResponse([{ ScheduleId: 7, Status: "Pending" }]);
  }
  return jsonResponse({ ok: true });
};

const client = createOcppCommandClient({
  loadSession: async () => ({
    access_token: "test-access-token",
    user: { id: "test-user" },
  }),
  loadClient: async () => ({
    supabaseUrl: "https://example.supabase.co/",
    supabaseKey: "test-anon-key",
  }),
  request: fakeRequest,
});

const overview = await client.readOverview();
assert.equal(overview.authenticated, true);
assert.equal(overview.statusError, "");
assert.equal(overview.scheduleError, "");
assert.deepEqual(
  calls.map(({ url, init }) => [url, init.method]),
  [
    [
      "https://example.supabase.co/functions/v1/ocpp-proxy/status",
      "GET",
    ],
    [
      "https://example.supabase.co/functions/v1/ocpp-proxy/schedule",
      "GET",
    ],
  ],
);
for (const { init } of calls) {
  assert.deepEqual(init.headers, {
    "Content-Type": "application/json",
    apikey: "test-anon-key",
    Authorization: "Bearer test-access-token",
  });
}

calls.length = 0;
await client.runCommand({
  cpId: "troy",
  connectorId: 1,
  command: "Reset",
  params: { Type: "Soft" },
});
await client.runCommand({
  cpId: "troy",
  connectorId: 1,
  command: "UnlockConnector",
  params: {},
});
await client.runCommand({
  cpId: "troy",
  connectorId: 1,
  command: "startcharge",
  params: { TagId: "RT92" },
});
await client.runCommand({
  cpId: "troy",
  connectorId: 1,
  command: "stopcharge",
  params: { TransactionId: 0 },
});

assert.deepEqual(
  calls.map(({ url, init }) => [
    url.replace(
      "https://example.supabase.co/functions/v1/ocpp-proxy",
      "",
    ),
    init.method,
    JSON.parse(init.body),
  ]),
  [
    [
      "/cmd/Reset/troy",
      "POST",
      { params: { ConnectorId: 1, Type: "Soft" } },
    ],
    [
      "/cmd/UnlockConnector/troy",
      "POST",
      { params: { ConnectorId: 1 } },
    ],
    [
      "/cmd/startcharge/troy",
      "POST",
      { params: { ConnectorId: 1, TagId: "RT92" } },
    ],
    [
      "/cmd/stopcharge/troy",
      "POST",
      { params: { ConnectorId: 1, TransactionId: 0 } },
    ],
  ],
  "Phase 1 command URLs and root.params bodies must match the live React implementation",
);

calls.length = 0;
await client.createSchedule({
  cpId: "simulator",
  connectorId: 1,
  tagId: "RT92",
  scheduledTime: "2026-07-28T12:00:00+08:00",
});
await client.cancelSchedule("schedule-7");
assert.deepEqual(
  calls.map(({ url, init }) => [
    url.replace(
      "https://example.supabase.co/functions/v1/ocpp-proxy",
      "",
    ),
    init.method,
    init.body ? JSON.parse(init.body) : null,
  ]),
  [
    [
      "/schedule",
      "POST",
      {
        ChargePointId: "simulator",
        ConnectorId: 1,
        TagId: "RT92",
        ScheduledTime: "2026-07-28T04:00:00.000Z",
      },
    ],
    ["/schedule/schedule-7", "DELETE", null],
  ],
);

const noSessionCalls = [];
const noSessionClient = createOcppCommandClient({
  loadSession: async () => null,
  loadClient: async () => {
    throw new Error("loadClient must not run without a session");
  },
  request: async (...args) => {
    noSessionCalls.push(args);
    throw new Error("request must not run without a session");
  },
});
assert.deepEqual(await noSessionClient.readOverview(), {
  authenticated: false,
  status: [],
  schedules: [],
  statusError: "",
  scheduleError: "",
});
await assert.rejects(
  noSessionClient.runCommand({
    cpId: "troy",
    connectorId: 1,
    command: "Reset",
    params: { Type: "Soft" },
  }),
  /authenticated session/,
);
assert.equal(noSessionCalls.length, 0, "logged-out mode must make zero proxy requests");

assert.deepEqual(OCPP_PHASE1_COMMANDS, [
  "Reset",
  "UnlockConnector",
  "startcharge",
  "stopcharge",
]);
for (const command of [
  "upgrade",
  "setprofile",
  "clearprofile",
  "changeavailable",
  "changeconfig",
]) {
  await assert.rejects(
    client.runCommand({
      cpId: "troy",
      connectorId: 1,
      command,
      params: {},
    }),
    /rejects command/,
  );
}

const statusRows = normalizeOcppStatusRows([
  {
    ChargePointId: "troy",
    Protocol: "OCPP16",
    OnlineConnectors: {
      1: { Status: "Available", TransactionId: null },
      2: { Status: "Charging", TransactionId: "17" },
    },
  },
]);
assert.deepEqual(
  statusRows.map((row) => [
    row.ChargePointId,
    row.ConnectorId,
    row.Status,
    row.TransactionId,
  ]),
  [
    ["troy", 1, "Available", null],
    ["troy", 2, "Charging", "17"],
  ],
);

const merged = mergeOcppCommandRows(
  [
    { pileNo: "troy", name: "Troy" },
    { pileNo: "offline-production", name: "Offline" },
  ],
  [
    {
      ChargePointId: "troy",
      OnlineConnectors: {
        1: { Status: "Available", TransactionId: null },
        2: { Status: "Charging", TransactionId: null },
      },
    },
    {
      ChargePointId: "simulator",
      OnlineConnectors: {
        1: { Status: "Preparing", TransactionId: null },
      },
    },
  ],
);
assert.deepEqual(
  merged.map((row) => [
    row.cpId,
    row.online?.ConnectorId ?? null,
    row.fromSnapshot,
  ]),
  [
    ["troy", 1, true],
    ["troy", 2, true],
    ["offline-production", null, true],
    ["simulator", 1, false],
  ],
  "snapshot rows stay visible, while /status supplies command connectors and unmatched online chargers",
);

const loggedOut = getOcppCommandAvailability({
  authenticated: false,
  onlineRow: statusRows[0],
});
assert.equal(loggedOut.online, true);
for (const key of ["reset", "unlock", "start", "stop", "schedule"]) {
  assert.equal(loggedOut[key], false, `logged-out ${key} must stay disabled`);
}

const offline = getOcppCommandAvailability({
  authenticated: true,
  onlineRow: null,
});
for (const key of ["reset", "unlock", "start", "stop", "schedule"]) {
  assert.equal(offline[key], false, `offline ${key} must stay disabled`);
}

const available = getOcppCommandAvailability({
  authenticated: true,
  onlineRow: statusRows[0],
});
assert.deepEqual(
  {
    reset: available.reset,
    unlock: available.unlock,
    start: available.start,
    stop: available.stop,
    schedule: available.schedule,
  },
  {
    reset: true,
    unlock: true,
    start: true,
    stop: false,
    schedule: true,
  },
);

const chargingWithoutTx = getOcppCommandAvailability({
  authenticated: true,
  onlineRow: {
    ChargePointId: "troy",
    ConnectorId: 1,
    Status: "Charging",
    TransactionId: null,
  },
});
assert.equal(chargingWithoutTx.stop, true);
assert.equal(chargingWithoutTx.stopTxId, 0, "Troy force-stop must fall back to TxId 0");
assert.equal(chargingWithoutTx.start, true, "live parity keeps canStart tied to txId==null");
assert.equal(parseOcppTransactionId("17"), 17);
assert.equal(parseOcppTransactionId("0"), null);

const schedules = normalizeOcppSchedules({
  data: [{ ScheduleId: 9, Status: "Pending", ChargePointId: "troy" }],
});
assert.equal(schedules[0].scheduleId, 9);
assert.equal(canCancelOcppSchedule(schedules[0]), true);
assert.equal(canCancelOcppSchedule({ status: "Triggered" }), false);
const defaultSchedule = defaultOcppScheduleLocalValue(
  new Date("2026-07-27T00:00:00Z").getTime(),
);
assert.equal(isFutureOcppSchedule(defaultSchedule, 0), true);

const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const helpers = { lang: "zh", escapeHtml };
const t = (key) => key;
const ct = (key, values = {}) =>
  translateOcppCommand("zh", key, values);
const baseRenderState = {
  autoRefresh: true,
  commandStatus: [
    {
      ChargePointId: "troy",
      OnlineConnectors: {
        1: { Status: "Available", TransactionId: null },
      },
    },
  ],
  commandSchedules: [],
  commandStatusError: "",
  commandScheduleError: "",
  actionBusy: false,
  pendingAction: null,
  commandToast: { message: "", kind: "info" },
};
const renderData = {
  piles: [
    {
      pileNo: "troy",
      name: "Troy",
      status: "normal",
      connectorTotal: 1,
      availableConnectorTotal: 1,
      faultConnectorTotal: 0,
      threePhase: false,
    },
  ],
};
const loggedOutHtml = renderOcppCommandStatus({
  data: renderData,
  state: { ...baseRenderState, commandAuthenticated: false },
  helpers,
  t,
  ct,
});
const loggedOutButtons =
  loggedOutHtml.match(/<button[^>]+data-ocpp-command="[^"]+"[^>]*>/g) ?? [];
assert.equal(loggedOutButtons.length, 5);
assert.equal(
  loggedOutButtons.every((button) => button.includes(" disabled")),
  true,
  "all five visible commands must render disabled without a session",
);

const onlineHtml = renderOcppCommandStatus({
  data: renderData,
  state: { ...baseRenderState, commandAuthenticated: true },
  helpers,
  t,
  ct,
});
const onlineButtons =
  onlineHtml.match(/<button[^>]+data-ocpp-command="[^"]+"[^>]*>/g) ?? [];
assert.equal(onlineButtons.length, 5);
assert.equal(
  onlineButtons.filter((button) => button.includes(" disabled")).length,
  1,
  "Available online connector enables reset/unlock/start/schedule but keeps stop gated",
);

const offlineHtml = renderOcppCommandStatus({
  data: renderData,
  state: {
    ...baseRenderState,
    commandAuthenticated: true,
    commandStatus: [],
  },
  helpers,
  t,
  ct,
});
assert.match(offlineHtml, /未連自建 server，不可命令/);
assert.equal(
  (offlineHtml.match(/title="未連自建 server，不可命令"/g) ?? []).length,
  5,
);

const startModalHtml = renderOcppCommandStatus({
  data: renderData,
  state: {
    ...baseRenderState,
    commandAuthenticated: true,
    pendingAction: {
      kind: "start",
      cpId: "troy",
      connectorId: 1,
      tagId: "",
      scheduledAt: "",
    },
  },
  helpers,
  t,
  ct,
});
assert.match(startModalHtml, /確認遠程啟動充電？/);
assert.match(startModalHtml, /troy \/ 1/);
assert.match(
  startModalHtml,
  /data-ocpp-command-confirm disabled/,
  "RemoteStart confirmation stays disabled until TagId is entered",
);

const scheduleModalHtml = renderOcppCommandStatus({
  data: renderData,
  state: {
    ...baseRenderState,
    commandAuthenticated: true,
    pendingAction: {
      kind: "schedule",
      cpId: "troy",
      connectorId: 1,
      tagId: "RT92",
      scheduledAt: "2099-07-28T12:00",
    },
  },
  helpers,
  t,
  ct,
});
assert.match(scheduleModalHtml, /預約開始充電/);
assert.match(scheduleModalHtml, /type="datetime-local"/);
assert.match(scheduleModalHtml, /value="RT92"/);
assert.doesNotMatch(
  scheduleModalHtml,
  /data-ocpp-command-confirm disabled/,
  "Schedule confirmation enables only after future time and TagId are both present",
);

const [monitorSource, commandSource, commandViewSource] = await Promise.all([
  readFile(
    new URL("../root-site/bizflow/ocpp-monitor.js", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../root-site/data/live-ocpp-commands.js", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../root-site/bizflow/ocpp-command-view.js", import.meta.url),
    "utf8",
  ),
]);
assert.match(
  commandViewSource,
  /\["reset", "unlock", "start", "stop", "schedule"\]/,
);
assert.match(commandViewSource, /data-ocpp-command="\$\{kind\}"/);
assert.match(commandViewSource, /data-ocpp-command-confirm/);
assert.match(monitorSource, /defaultOcppScheduleLocalValue/);
assert.match(monitorSource, /command: "Reset"[^]*params: \{ Type: "Soft" \}/);
assert.match(monitorSource, /command: "startcharge"[^]*TagId/);
assert.match(monitorSource, /command: "stopcharge"[^]*TransactionId: action\.txId/);
assert.doesNotMatch(monitorSource, /formalOnly/);
assert.match(commandSource, /functions\/v1\/ocpp-proxy/);
assert.doesNotMatch(commandSource, /8081|vendor/);
for (const forbidden of [
  "upgrade",
  "setprofile",
  "clearprofile",
  "changeavailable",
  "changeconfig",
]) {
  assert.doesNotMatch(
    `${monitorSource}\n${commandSource}\n${commandViewSource}`,
    new RegExp(forbidden, "i"),
    `red command ${forbidden} must be absent from production command code`,
  );
}

console.log(
  "OCPP Phase 1 command contracts: PASS (mock-only; zero real proxy or charger requests)",
);
