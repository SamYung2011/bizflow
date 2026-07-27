const CONNECTOR_STATUS_BY_CODE = Object.freeze({
  0: "Undefined",
  1: "Available",
  2: "Occupied",
  3: "Unavailable",
  4: "Faulted",
});

const FORCE_STOP_STATUSES = new Set([
  "charging",
  "suspendedev",
  "preparing",
  "occupied",
]);

function firstValue(row, ...keys) {
  return keys.map((key) => row?.[key]).find((value) => value != null);
}

export function normalizeOcppStatusRows(data) {
  const list = Array.isArray(data)
    ? data
    : Array.isArray(data?.data)
      ? data.data
      : [];
  return list.flatMap((chargePoint) => {
    const cpId = String(
      firstValue(
        chargePoint,
        "ChargePointId",
        "chargePointId",
        "id",
        "Id",
      ) ?? "",
    ).trim();
    const protocol = firstValue(chargePoint, "Protocol", "protocol");
    const lastUpdate = firstValue(
      chargePoint,
      "LastUpdate",
      "lastUpdate",
      "LastUpdateUnix",
      "last_update",
    );
    const connectors = firstValue(
      chargePoint,
      "OnlineConnectors",
      "onlineConnectors",
    );
    if (
      !connectors ||
      typeof connectors !== "object" ||
      Object.keys(connectors).length === 0
    ) {
      return [
        {
          ChargePointId: cpId,
          Protocol: protocol,
          LastUpdate: lastUpdate,
        },
      ];
    }
    return Object.entries(connectors).map(([key, value]) => ({
      ...(value || {}),
      ChargePointId: String(
        firstValue(value, "ChargePointId", "chargePointId") ?? cpId,
      ).trim(),
      ConnectorId:
        firstValue(value, "ConnectorId", "connectorId") ?? Number(key),
      Protocol: protocol,
      LastUpdate:
        firstValue(value, "LastUpdate", "lastUpdate") ?? lastUpdate,
    }));
  });
}

export function normalizeOcppSchedules(data) {
  const list = Array.isArray(data)
    ? data
    : Array.isArray(data?.data)
      ? data.data
      : [];
  return list.map((row) => ({
    scheduleId: firstValue(row, "ScheduleId", "scheduleId"),
    chargePointId: firstValue(row, "ChargePointId", "chargePointId"),
    connectorId: firstValue(row, "ConnectorId", "connectorId"),
    tagId: firstValue(row, "TagId", "tagId"),
    scheduledTime: firstValue(row, "ScheduledTime", "scheduledTime"),
    status: firstValue(row, "Status", "status"),
    result: firstValue(row, "Result", "result"),
    triggeredAt: firstValue(row, "TriggeredAt", "triggeredAt"),
    createdAt: firstValue(row, "CreatedAt", "createdAt"),
    comment: firstValue(row, "Comment", "comment"),
  }));
}

export function parseOcppTransactionId(raw) {
  if (raw == null) return null;
  if (typeof raw === "number") {
    return Number.isInteger(raw) && raw > 0 ? raw : null;
  }
  if (typeof raw === "string" && /^\d+$/.test(raw.trim())) {
    const parsed = Number.parseInt(raw, 10);
    return parsed > 0 ? parsed : null;
  }
  return null;
}

export function normalizeOcppConnectorStatus(status) {
  if (status == null || status === "") return "";
  if (typeof status === "number" && Number.isFinite(status)) {
    return CONNECTOR_STATUS_BY_CODE[status] || String(status);
  }
  if (typeof status === "string" && /^\d+$/.test(status.trim())) {
    const code = Number(status.trim());
    return CONNECTOR_STATUS_BY_CODE[code] || status;
  }
  return String(status);
}

function rowCpId(row) {
  return String(
    firstValue(row, "ChargePointId", "chargePointId") ?? "",
  ).trim();
}

function onlineRowKey(row) {
  const connectorId = firstValue(row, "ConnectorId", "connectorId");
  return `${rowCpId(row)}:${connectorId ?? ""}`;
}

export function mergeOcppCommandRows(snapshotPiles, statusData) {
  const onlineRows = normalizeOcppStatusRows(statusData);
  const uniqueOnlineRows = [
    ...new Map(
      onlineRows
        .filter((row) => rowCpId(row))
        .map((row) => [onlineRowKey(row), row]),
    ).values(),
  ];
  const onlineByPile = new Map();
  uniqueOnlineRows.forEach((row) => {
    const cpId = rowCpId(row);
    if (!onlineByPile.has(cpId)) onlineByPile.set(cpId, []);
    onlineByPile.get(cpId).push(row);
  });

  const snapshotIds = new Set();
  const merged = (Array.isArray(snapshotPiles) ? snapshotPiles : []).flatMap(
    (snapshot) => {
      const cpId = String(snapshot?.pileNo ?? "").trim();
      if (cpId) snapshotIds.add(cpId);
      const matches = onlineByPile.get(cpId) ?? [];
      if (matches.length === 0) {
        return [{ cpId, snapshot, online: null, fromSnapshot: true }];
      }
      return matches.map((online) => ({
        cpId,
        snapshot,
        online,
        fromSnapshot: true,
      }));
    },
  );

  uniqueOnlineRows.forEach((online) => {
    const cpId = rowCpId(online);
    if (!snapshotIds.has(cpId)) {
      merged.push({
        cpId,
        snapshot: { pileNo: cpId },
        online,
        fromSnapshot: false,
      });
    }
  });
  return merged;
}

export function getOcppCommandAvailability({
  authenticated,
  onlineRow,
  busy = false,
}) {
  const cpId = rowCpId(onlineRow);
  const connectorId = firstValue(onlineRow, "ConnectorId", "connectorId");
  const txId = parseOcppTransactionId(
    firstValue(onlineRow, "TransactionId", "transactionId"),
  );
  const status = normalizeOcppConnectorStatus(
    firstValue(onlineRow, "Status", "status"),
  );
  const online = Boolean(onlineRow && cpId);
  const allowed = Boolean(authenticated && online && !busy);
  return {
    authenticated: Boolean(authenticated),
    busy: Boolean(busy),
    online,
    cpId,
    connectorId,
    txId,
    stopTxId: txId ?? 0,
    status,
    reset: allowed,
    unlock: allowed && connectorId != null,
    start: allowed && connectorId != null && txId == null,
    stop:
      allowed &&
      FORCE_STOP_STATUSES.has(String(status || "").trim().toLowerCase()),
    schedule: allowed && connectorId != null,
  };
}

export function defaultOcppScheduleLocalValue(now = Date.now()) {
  const target = new Date(now + 15 * 60 * 1000);
  target.setSeconds(0, 0);
  const local = new Date(
    target.getTime() - target.getTimezoneOffset() * 60 * 1000,
  );
  return local.toISOString().slice(0, 16);
}

export function isFutureOcppSchedule(value, now = Date.now()) {
  const target = new Date(value);
  return (
    Boolean(value) &&
    !Number.isNaN(target.getTime()) &&
    target.getTime() > now
  );
}

export function canCancelOcppSchedule(schedule) {
  return String(schedule?.status || "").trim().toLowerCase() === "pending";
}
