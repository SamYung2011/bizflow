import { getSession, getSupabaseClient } from "./auth.js";

export const OCPP_PHASE1_COMMANDS = Object.freeze([
  "Reset",
  "UnlockConnector",
  "startcharge",
  "stopcharge",
]);

const COMMAND_SET = new Set(OCPP_PHASE1_COMMANDS);

function requireText(value, label) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

function errorText(error) {
  return String(error?.message || error || "Unknown error");
}

function assertCommandParams(command, params) {
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    throw new Error("OCPP command params must be an object");
  }
  if (Object.hasOwn(params, "ConnectorId")) {
    throw new Error("ConnectorId must use the command connectorId field");
  }
  if (command === "Reset" && params.Type !== "Soft") {
    throw new Error("Phase 1 only permits Soft Reset");
  }
  const allowedKeys = {
    Reset: ["Type"],
    UnlockConnector: [],
    startcharge: ["TagId"],
    stopcharge: ["TransactionId"],
  }[command];
  if (Object.keys(params).some((key) => !allowedKeys.includes(key))) {
    throw new Error(`${command} received an unsupported Phase 1 param`);
  }
  if (command === "UnlockConnector" && Object.keys(params).length !== 0) {
    throw new Error("UnlockConnector does not accept extra Phase 1 params");
  }
  if (command === "startcharge" && !String(params.TagId ?? "").trim()) {
    throw new Error("startcharge requires TagId");
  }
  if (
    command === "stopcharge" &&
    (!Number.isInteger(params.TransactionId) || params.TransactionId < 0)
  ) {
    throw new Error("stopcharge requires a non-negative TransactionId");
  }
}

function assertAllowedRequest(subPath, method) {
  const normalizedMethod = String(method || "GET").toUpperCase();
  if (normalizedMethod === "GET" && ["/status", "/schedule"].includes(subPath)) {
    return;
  }
  if (normalizedMethod === "POST" && subPath === "/schedule") return;
  if (
    normalizedMethod === "DELETE" &&
    /^\/schedule\/[^/?#]+$/.test(subPath)
  ) {
    return;
  }
  const commandMatch = subPath.match(
    /^\/cmd\/(Reset|UnlockConnector|startcharge|stopcharge)\/[^/?#]+$/,
  );
  if (
    normalizedMethod === "POST" &&
    commandMatch &&
    COMMAND_SET.has(commandMatch[1])
  ) {
    return;
  }
  throw new Error(`OCPP Phase 1 rejects request: ${normalizedMethod} ${subPath}`);
}

async function parseResponse(response) {
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (!response.ok) {
    const detail =
      parsed && typeof parsed === "object"
        ? (parsed.error ?? parsed.msg)
        : parsed;
    throw new Error(`HTTP ${response.status}: ${detail ?? "Unknown error"}`);
  }
  return parsed;
}

export function createOcppCommandClient({
  loadSession = getSession,
  loadClient = getSupabaseClient,
  request = (...args) => fetch(...args),
} = {}) {
  async function loadContext() {
    const session = await loadSession();
    if (!session) return null;
    const client = await loadClient();
    if (!client?.supabaseUrl || !client?.supabaseKey || !session.access_token) {
      throw new Error("Supabase OCPP command client is not configured");
    }
    return {
      accessToken: session.access_token,
      anonKey: client.supabaseKey,
      baseUrl: String(client.supabaseUrl).replace(/\/$/, ""),
    };
  }

  async function callOcppProxy(
    subPath,
    { method = "GET", body, context = null } = {},
  ) {
    assertAllowedRequest(subPath, method);
    const activeContext = context ?? (await loadContext());
    if (!activeContext) {
      throw new Error("OCPP commands require an authenticated session");
    }
    const init = {
      method,
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        apikey: activeContext.anonKey,
        Authorization: `Bearer ${activeContext.accessToken}`,
      },
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    const response = await request(
      `${activeContext.baseUrl}/functions/v1/ocpp-proxy${subPath}`,
      init,
    );
    return parseResponse(response);
  }

  return Object.freeze({
    async readOverview() {
      const context = await loadContext();
      if (!context) {
        return {
          authenticated: false,
          status: [],
          schedules: [],
          statusError: "",
          scheduleError: "",
        };
      }
      const [statusResult, scheduleResult] = await Promise.allSettled([
        callOcppProxy("/status", { context }),
        callOcppProxy("/schedule", { context }),
      ]);
      return {
        authenticated: true,
        status: statusResult.status === "fulfilled" ? statusResult.value : [],
        schedules:
          scheduleResult.status === "fulfilled" ? scheduleResult.value : [],
        statusError:
          statusResult.status === "rejected"
            ? errorText(statusResult.reason)
            : "",
        scheduleError:
          scheduleResult.status === "rejected"
            ? errorText(scheduleResult.reason)
            : "",
      };
    },

    async runCommand({ cpId, connectorId = null, command, params = {} }) {
      const safeCpId = requireText(cpId, "ChargePointId");
      if (!COMMAND_SET.has(command)) {
        throw new Error(`OCPP Phase 1 rejects command: ${command}`);
      }
      assertCommandParams(command, params);
      if (
        ["UnlockConnector", "startcharge"].includes(command) &&
        connectorId == null
      ) {
        throw new Error(`${command} requires ConnectorId`);
      }
      return callOcppProxy(
        `/cmd/${encodeURIComponent(command)}/${encodeURIComponent(safeCpId)}`,
        {
          method: "POST",
          body: {
            params: {
              ConnectorId: connectorId,
              ...params,
            },
          },
        },
      );
    },

    async createSchedule({
      cpId,
      connectorId,
      tagId,
      scheduledTime,
    }) {
      const safeCpId = requireText(cpId, "ChargePointId");
      const safeTagId = requireText(tagId, "TagId");
      if (connectorId == null) throw new Error("Schedule requires ConnectorId");
      const target = new Date(scheduledTime);
      if (Number.isNaN(target.getTime())) {
        throw new Error("Schedule requires a valid time");
      }
      return callOcppProxy("/schedule", {
        method: "POST",
        body: {
          ChargePointId: safeCpId,
          ConnectorId: connectorId ?? 1,
          TagId: safeTagId,
          ScheduledTime: target.toISOString(),
        },
      });
    },

    async cancelSchedule(scheduleId) {
      const safeScheduleId = requireText(scheduleId, "ScheduleId");
      return callOcppProxy(
        `/schedule/${encodeURIComponent(safeScheduleId)}`,
        { method: "DELETE" },
      );
    },
  });
}

export const ocppCommandClient = createOcppCommandClient();
