import React, { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "../../i18n.jsx";
import { callOcppAdmin } from "../../lib/ocppAdmin.js";
import {
  fmtMoney, MoneyText,
  FilterBar, Select, ErrorBanner, EmptyState, Pager, TableHead,
  TABLE_WRAP_STYLE, TABLE_STYLE, TD_STYLE, MONO_TD_STYLE,
} from "./finance/financeShared.jsx";

// 充電報表 (OcppReports) — chargecms rc_orders live 聚合（list 唯讀）
// 零寫入 / 不發 OCPP 命令 / 不動 vendor 8081 / 不動 chargecms PHP
// 數據由 readapi /api/reports/charging 聚合，Edge 只做 admin guard + 轉發

const PAGE_LIMIT = 50;

const PERIOD_OPTIONS = [
  ["day", "日報"],
  ["month", "月報"],
  ["year", "年報"],
];

function fmtKwh(v) {
  if (v == null || v === "") return "0.000";
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(3) : String(v);
}

function optionName(row) {
  return row?.name || row?.operatorName || row?.stationName || "";
}

export default function OcppReports({ session, isAdmin }) {
  const { t } = useT();
  const [rows, setRows] = useState([]);
  const [operators, setOperators] = useState([]);
  const [stations, setStations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [period, setPeriod] = useState("day");
  const [operatorId, setOperatorId] = useState("");
  const [stationId, setStationId] = useState("");
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const aliveRef = useRef(true);

  const accessToken = session?.access_token;

  const loadFilters = useCallback(async () => {
    if (!isAdmin || !accessToken) return;
    const [operatorRes, stationRes] = await Promise.allSettled([
      callOcppAdmin("/operators?limit=200", { accessToken }),
      callOcppAdmin("/stations?limit=200", { accessToken }),
    ]);
    if (!aliveRef.current) return;
    if (operatorRes.status === "fulfilled") {
      setOperators(Array.isArray(operatorRes.value?.data) ? operatorRes.value.data : []);
    }
    if (stationRes.status === "fulfilled") {
      setStations(Array.isArray(stationRes.value?.data) ? stationRes.value.data : []);
    }
  }, [isAdmin, accessToken]);

  const refresh = useCallback(async ({ force = false } = {}) => {
    if (!isAdmin || !accessToken) return;
    setLoading(true);
    setErr("");
    try {
      const qs = new URLSearchParams();
      qs.set("period", period);
      qs.set("limit", String(PAGE_LIMIT));
      qs.set("offset", String(offset));
      if (operatorId) qs.set("operatorId", operatorId);
      if (stationId !== "") qs.set("stationId", stationId);
      const data = await callOcppAdmin(`/reports/charging?${qs}`, { accessToken, force });
      if (!aliveRef.current) return;
      setRows(Array.isArray(data?.data) ? data.data : []);
      setHasMore(Boolean(data?.page?.hasMore));
    } catch (e) {
      if (!aliveRef.current) return;
      setErr(String(e?.message || e));
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, [isAdmin, accessToken, period, operatorId, stationId, offset]);

  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  useEffect(() => { loadFilters(); }, [loadFilters]);
  useEffect(() => { refresh(); }, [refresh]);

  if (!isAdmin) {
    return <div style={{ padding: 40, textAlign: "center", color: "#999" }}>{t("無權訪問")}</div>;
  }

  const operatorOptions = [
    ["", "全部運營商"],
    ...operators.map((op) => [String(op.operatorId ?? op.id ?? ""), optionName(op) || String(op.operatorId ?? "")]),
  ].filter(([value], index) => index === 0 || value !== "");

  const stationOptions = [
    ["", "全部站點"],
    ["0", "未分配站點"],
    ...stations.map((s) => [String(s.stationId ?? s.id ?? ""), optionName(s) || String(s.stationId ?? "")]),
  ].filter(([value], index) => index < 2 || value !== "");

  const empty = !loading && !err && rows.length === 0;

  return (
    <div style={{ padding: "16px 20px", maxWidth: 1400 }}>
      <FilterBar title={t("充電報表")} onRefresh={refresh} loading={loading} count={rows.length}>
        <Select value={period} options={PERIOD_OPTIONS} onChange={(v) => { setOffset(0); setPeriod(v); }} />
        <Select value={operatorId} options={operatorOptions} onChange={(v) => { setOffset(0); setOperatorId(v); }} />
        <Select value={stationId} options={stationOptions} onChange={(v) => { setOffset(0); setStationId(v); }} />
      </FilterBar>

      <ErrorBanner message={err} />
      {empty && <EmptyState message={t("無報表數據")} />}

      {rows.length > 0 && (
        <>
          <div style={TABLE_WRAP_STYLE}>
            <table style={TABLE_STYLE}>
              <TableHead columns={[t("週期"), t("運營商"), t("站點"), t("充電次數"), t("度數kWh"), t("金額")]} />
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.periodKey}-${r.operatorId}-${r.stationId}`} style={{ borderBottom: "1px solid #f3f4f6" }}>
                    <td style={MONO_TD_STYLE}>{r.periodKey || "—"}</td>
                    <td style={TD_STYLE}>{r.operatorName || (r.operatorId ? `#${r.operatorId}` : "—")}</td>
                    <td style={TD_STYLE}>{r.stationName || (Number(r.stationId) === 0 ? t("未分配站點") : (r.stationId ? `#${r.stationId}` : "—"))}</td>
                    <td style={{ ...TD_STYLE, textAlign: "right" }}>{Number(r.chargeCount || 0)}</td>
                    <td style={{ ...TD_STYLE, textAlign: "right" }}>{fmtKwh(r.chargingCapacityKwh)}</td>
                    <td style={{ ...TD_STYLE, textAlign: "right" }}><MoneyText value={r.amount} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager
            offset={offset} pageLimit={PAGE_LIMIT} count={rows.length} hasMore={hasMore} loading={loading}
            onPrev={() => setOffset((o) => Math.max(0, o - PAGE_LIMIT))}
            onNext={() => setOffset((o) => o + PAGE_LIMIT)}
          />
        </>
      )}
    </div>
  );
}
