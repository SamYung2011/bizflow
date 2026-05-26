import React, { useState, useEffect, useRef, useCallback } from "react";
import { useT } from "../../i18n.jsx";
import { callOcppAdmin, fmtUnixTs } from "../../lib/ocppAdmin.js";

// 充電訂單 — chargecms 主表 rc_orders（list）+ chargeorders.rc_orders_<N> 分表（detail）
// 只讀，零寫入 / 不發 OCPP 命令 / 不動 vendor 8081

function fmtAmount(v) {
  if (v == null || v === "") return "—";
  return v;
}

function fmtNumber(v, unit = "") {
  if (v == null || v === "" || Number(v) === 0) return "—";
  return unit ? `${v} ${unit}` : String(v);
}

function fmtDuration(seconds, t) {
  if (!seconds || seconds <= 0) return "—";
  const s = Number(seconds);
  if (!Number.isFinite(s)) return "—";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}${t("時")} ${m}${t("分")} ${sec}${t("秒")}`;
  if (m > 0) return `${m}${t("分")} ${sec}${t("秒")}`;
  return `${sec}${t("秒")}`;
}

function hkDateStartTs(date) {
  const ts = Math.floor(new Date(`${date}T00:00:00+08:00`).getTime() / 1000);
  return Number.isFinite(ts) ? ts : null;
}

function Section({ title, children }) {
  return (
    <section style={{ marginBottom: 18 }}>
      <h4 style={{ margin: "0 0 8px", fontSize: 14, fontWeight: 600 }}>{title}</h4>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <tbody>{children}</tbody>
      </table>
    </section>
  );
}

function Row({ label, value }) {
  return (
    <tr style={{ borderBottom: "1px solid #f3f4f6" }}>
      <td style={{ padding: "6px 10px", color: "#666", width: 200, verticalAlign: "top" }}>{label}</td>
      <td style={{ padding: "6px 10px", fontFamily: typeof value === "string" && /^[0-9.\s\-:]+$/.test(value) ? "monospace" : "inherit" }}>
        {value ?? "—"}
      </td>
    </tr>
  );
}

function OrderDetailModal({ userId, orderId, accessToken, onClose, t }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    setLoading(true);
    setErr("");
    callOcppAdmin(`/orders/${userId}/${orderId}`, { accessToken })
      .then((res) => { if (aliveRef.current) setDetail(res?.data || null); })
      .catch((e) => { if (aliveRef.current) setErr(String(e?.message || e)); })
      .finally(() => { if (aliveRef.current) setLoading(false); });
    return () => { aliveRef.current = false; };
  }, [userId, orderId, accessToken]);

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 999, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 8, padding: 24, width: "min(900px, 95vw)", maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
            {t("訂單詳情")} #{orderId}
          </h3>
          <button onClick={onClose} style={{ marginLeft: "auto", padding: "4px 12px", border: "1px solid #ddd", background: "#fafafa", borderRadius: 6, cursor: "pointer", fontSize: 13 }}>
            {t("關閉")}
          </button>
        </div>

        {loading && <div style={{ padding: 20, textAlign: "center", color: "#888" }}>{t("載入中…")}</div>}
        {err && (
          <div style={{ background: "#ffebee", border: "1px solid #ffcdd2", color: "#c62828", padding: "8px 12px", borderRadius: 6, fontSize: 13 }}>
            {err}
          </div>
        )}

        {detail && (
          <>
            <Section title={t("基本資訊")}>
              <Row label={t("訂單編號")} value={orderId} />
              <Row label={t("用戶 ID")} value={detail.userId || "—"} />
              <Row label={t("運營商")} value={detail.operatorName || "—"} />
              <Row label={t("充電站")} value={detail.stationName || "—"} />
              <Row label={t("樁編號")} value={detail.pileNo || "—"} />
              <Row label={t("連接器")} value={detail.connectorId || "—"} />
              <Row label={t("OCPP TransactionId")} value={detail.transactionId || "—"} />
              <Row label={t("起始卡號")} value={detail.startTagId || "—"} />
              <Row label={t("結束卡號")} value={detail.stopTagId || "—"} />
              <Row label={t("起始結果")} value={detail.startResult || "—"} />
              <Row label={t("結束原因")} value={detail.stopReason || "—"} />
              <Row label={t("支付方式")} value={detail.payment || "—"} />
            </Section>

            <Section title={t("時間")}>
              <Row label={t("開始時間")} value={fmtUnixTs(detail.startTime)} />
              <Row label={t("結束時間")} value={fmtUnixTs(detail.endTime)} />
              <Row label={t("支付時間")} value={fmtUnixTs(detail.payTime)} />
              <Row label={t("充電時長")} value={fmtDuration(detail.chargingTime, t)} />
            </Section>

            <Section title={t("電量")}>
              <Row label={t("起始電表")} value={fmtNumber(detail.meterStart, "kWh")} />
              <Row label={t("結束電表")} value={fmtNumber(detail.meterStop, "kWh")} />
              <Row label={t("充電量")} value={fmtNumber(detail.chargingCapacity, "kWh")} />
              <Row label={t("有功電能")} value={fmtNumber(detail.energyActiveImportRegister, "kWh")} />
            </Section>

            <Section title={t("電壓 / 電流 三相")}>
              <Row label={t("電壓 L1 / L2 / L3")} value={`${fmtNumber(detail.voltage, "V")} / ${fmtNumber(detail.voltage2, "V")} / ${fmtNumber(detail.voltage3, "V")}`} />
              <Row label={t("電流 L1 / L2 / L3")} value={`${fmtNumber(detail.current, "A")} / ${fmtNumber(detail.current2, "A")} / ${fmtNumber(detail.current3, "A")}`} />
            </Section>

            <Section title={t("金額")}>
              <Row label={t("貨幣")} value={detail.currency || "—"} />
              <Row label={t("單價")} value={fmtAmount(detail.price)} />
              <Row label={t("電費單價")} value={fmtAmount(detail.kwhCost)} />
              <Row label={t("服務費")} value={fmtAmount(detail.serviceFee)} />
              <Row label={t("手續費")} value={fmtAmount(detail.handlingFee)} />
              <Row label={t("折扣")} value={fmtAmount(detail.discount)} />
              <Row label={t("充值金額")} value={fmtAmount(detail.chargeAmount)} />
              <Row label={t("訂單金額")} value={fmtAmount(detail.amount)} />
            </Section>
          </>
        )}
      </div>
    </div>
  );
}

export default function OcppOrders({ session, isAdmin }) {
  const { t } = useT();
  const [rows, setRows] = useState([]);
  const [stations, setStations] = useState([]);
  const [operators, setOperators] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [filterOperatorId, setFilterOperatorId] = useState("");
  const [filterStationId, setFilterStationId] = useState("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [filterQ, setFilterQ] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [selected, setSelected] = useState(null);
  const aliveRef = useRef(true);

  const accessToken = session?.access_token;

  const refresh = useCallback(async () => {
    if (!isAdmin || !accessToken) return;
    setLoading(true);
    setErr("");
    try {
      const qs = new URLSearchParams();
      if (filterOperatorId) qs.set("operatorId", filterOperatorId);
      if (filterStationId !== "") qs.set("stationId", filterStationId);
      if (filterDateFrom) {
        const ts = hkDateStartTs(filterDateFrom);
        if (Number.isFinite(ts) && ts > 0) qs.set("dateFrom", String(ts));
      }
      if (filterDateTo) {
        // dateTo is exclusive upper bound — add 1 day so the picked day is included
        const ts = hkDateStartTs(filterDateTo);
        if (Number.isFinite(ts) && ts > 0) qs.set("dateTo", String(ts + 86400));
      }
      if (filterQ) qs.set("q", filterQ);
      qs.set("limit", "100");
      const data = await callOcppAdmin(`/orders?${qs}`, { accessToken });
      if (!aliveRef.current) return;
      setRows(Array.isArray(data?.data) ? data.data : []);
    } catch (e) {
      if (!aliveRef.current) return;
      setErr(String(e?.message || e));
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, [isAdmin, accessToken, filterOperatorId, filterStationId, filterDateFrom, filterDateTo, filterQ]);

  const loadFilters = useCallback(async () => {
    if (!isAdmin || !accessToken) return;
    try {
      const [opsRes, stationsRes] = await Promise.all([
        callOcppAdmin("/operators", { accessToken }).catch(() => null),
        callOcppAdmin("/stations?limit=200", { accessToken }).catch(() => null),
      ]);
      if (!aliveRef.current) return;
      setOperators(Array.isArray(opsRes?.data) ? opsRes.data : []);
      setStations(Array.isArray(stationsRes?.data) ? stationsRes.data : []);
    } catch {
      // dropdowns are optional; swallow
    }
  }, [isAdmin, accessToken]);

  useEffect(() => {
    aliveRef.current = true;
    loadFilters();
    return () => { aliveRef.current = false; };
  }, [loadFilters]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (!isAdmin) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "#999" }}>
        {t("無權訪問")}
      </div>
    );
  }

  const empty = !loading && !err && rows.length === 0;

  return (
    <div>
      <div style={{ background: "#fff7e6", border: "1px solid #ffd58a", color: "#92400e", padding: "10px 14px", borderRadius: 6, fontSize: 13, marginBottom: 16 }}>
        <strong>{t("充電訂單 · 演示階段")}</strong>{" "}
        {t("此列表讀 chargecms 主表 rc_orders；點「詳情」會從 chargeorders 分表拉每張訂單的完整字段（電壓電流三相 / 充電時長 / 金額明細）。只讀，零寫入，不影響 vendor 8081 / chargecms PHP / 樁 firmware。")}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{t("充電訂單")}</h3>

        <select value={filterOperatorId} onChange={(e) => setFilterOperatorId(e.target.value)} style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid #ddd", fontSize: 13 }}>
          <option value="">{t("全部運營商")}</option>
          {operators.map((o) => (
            <option key={o.operatorId} value={o.operatorId}>{o.name}</option>
          ))}
        </select>

        <select value={filterStationId} onChange={(e) => setFilterStationId(e.target.value)} style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid #ddd", fontSize: 13 }}>
          <option value="">{t("全部站點")}</option>
          <option value="0">{t("私人桩（無站點）")}</option>
          {stations.map((s) => (
            <option key={s.stationId} value={s.stationId}>{s.name || `#${s.stationId}`}</option>
          ))}
        </select>

        <label style={{ fontSize: 12, color: "#666" }}>
          {t("日期從")}{" "}
          <input type="date" value={filterDateFrom} onChange={(e) => setFilterDateFrom(e.target.value)} style={{ padding: "3px 6px", borderRadius: 6, border: "1px solid #ddd", fontSize: 13 }} />
        </label>
        <label style={{ fontSize: 12, color: "#666" }}>
          {t("日期到")}{" "}
          <input type="date" value={filterDateTo} onChange={(e) => setFilterDateTo(e.target.value)} style={{ padding: "3px 6px", borderRadius: 6, border: "1px solid #ddd", fontSize: 13 }} />
        </label>

        <form
          onSubmit={(e) => { e.preventDefault(); setFilterQ(searchInput.trim()); }}
          style={{ display: "flex", gap: 6 }}
        >
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={t("訂單號 / 用戶 ID / 樁編號 / 站名")}
            style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid #ddd", fontSize: 13, width: 240 }}
          />
          <button type="submit" style={{ padding: "4px 14px", borderRadius: 6, border: "1px solid #1976d2", background: "#1976d2", color: "#fff", fontSize: 13, cursor: "pointer" }}>
            {t("搜尋")}
          </button>
        </form>

        <button onClick={refresh} disabled={loading} style={{ padding: "4px 12px", borderRadius: 6, border: "1px solid #ddd", background: loading ? "#f3f4f6" : "#fff", cursor: loading ? "default" : "pointer", fontSize: 13 }}>
          {loading ? t("載入中…") : t("刷新")}
        </button>

        <span style={{ marginLeft: "auto", fontSize: 12, color: "#888" }}>
          {t("共")} {rows.length} {t("單")}
        </span>
      </div>

      {err && (
        <div style={{ background: "#ffebee", border: "1px solid #ffcdd2", color: "#c62828", padding: "8px 12px", borderRadius: 6, fontSize: 13, marginBottom: 12 }}>
          {err}
        </div>
      )}

      {empty && (
        <div style={{ padding: 40, textAlign: "center", color: "#888", border: "1px dashed #ddd", borderRadius: 8 }}>
          {t("無訂單數據")}
        </div>
      )}

      {rows.length > 0 && (
        <div style={{ overflowX: "auto", border: "1px solid #eee", borderRadius: 8 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#fafafa", textAlign: "left" }}>
                {[t("時間"), t("訂單號"), t("用戶 ID"), t("運營商"), t("站點"), t("樁編號"), t("槍號"), t("充電量"), t("金額"), t("操作")].map((h) => (
                  <th key={h} style={{ padding: "8px 10px", borderBottom: "1px solid #eee", fontWeight: 600, color: "#555" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.userId}-${r.orderId}`} style={{ borderBottom: "1px solid #f3f4f6" }}>
                  <td style={{ padding: "8px 10px", fontSize: 12, color: "#666", whiteSpace: "nowrap" }}>{fmtUnixTs(r.createdAt)}</td>
                  <td style={{ padding: "8px 10px", fontFamily: "monospace", fontSize: 12 }}>{r.orderId || "—"}</td>
                  <td style={{ padding: "8px 10px", fontFamily: "monospace", fontSize: 12, color: "#666" }}>{r.userId || "—"}</td>
                  <td style={{ padding: "8px 10px" }}>{r.operatorName || "—"}</td>
                  <td style={{ padding: "8px 10px" }}>{r.stationName || (r.stationId === 0 ? t("私人桩") : "—")}</td>
                  <td style={{ padding: "8px 10px", fontFamily: "monospace" }}>{r.pileNo || "—"}</td>
                  <td style={{ padding: "8px 10px", textAlign: "center" }}>{r.connectorNo || "—"}</td>
                  <td style={{ padding: "8px 10px", textAlign: "right", fontFamily: "monospace" }}>{fmtNumber(r.chargingCapacity, "kWh")}</td>
                  <td style={{ padding: "8px 10px", textAlign: "right", fontFamily: "monospace" }}>{fmtAmount(r.amount)}</td>
                  <td style={{ padding: "8px 10px" }}>
                    <button
                      onClick={() => setSelected({ userId: r.userId, orderId: r.orderId })}
                      disabled={!r.userId || !r.orderId}
                      style={{ padding: "4px 10px", borderRadius: 4, border: "1px solid #e5e7eb", background: "#fff", color: r.userId && r.orderId ? "#1976d2" : "#bbb", fontSize: 12, cursor: r.userId && r.orderId ? "pointer" : "default" }}
                    >
                      {t("詳情")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <OrderDetailModal
          userId={selected.userId}
          orderId={selected.orderId}
          accessToken={accessToken}
          onClose={() => setSelected(null)}
          t={t}
        />
      )}
    </div>
  );
}
