import React, { useState, useEffect, useRef, useCallback } from "react";
import { useT } from "../../i18n.jsx";
import { callOcppAdmin, fmtUnixTs } from "../../lib/ocppAdmin.js";

// 運營商 (Operators) — chargecms 表 rc_customer_operator（list 唯讀）
// 零寫入 / 不發 OCPP 命令 / 不動 vendor 8081 / 不動 chargecms PHP
// 共用 /api/operators：不帶參數時各頁面 filter 下拉用（取 {operatorId, name}）；
// 帶 status/q/limit 時本 admin view 用完整 16 欄位（含財務字段，僅 admin 可見）

const STATUS_OPTIONS = [
  ["all", "全部狀態"],
  ["normal", "正常"],
  ["hidden", "隱藏"],
];

function statusTone(status) {
  const k = String(status || "").toLowerCase();
  if (k === "normal") return { bg: "#d1fae5", fg: "#065f46" };
  return { bg: "#f3f4f6", fg: "#6b7280" };
}

function StatusChip({ status, t }) {
  const { bg, fg } = statusTone(status);
  const label = status === "normal" ? t("正常") : status === "hidden" ? t("隱藏") : status || t("未知");
  return (
    <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 10, background: bg, color: fg, fontSize: 11, fontWeight: 600 }}>
      {label}
    </span>
  );
}

// decimal 金額字段（chargecms 用 DECIMAL，mysql2 返字符串）→ 2 位小數顯示
function fmtMoney(v) {
  if (v == null || v === "") return "0.00";
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : String(v);
}

function DetailRow({ label, children }) {
  return (
    <div style={{ display: "flex", gap: 8, fontSize: 13, padding: "3px 0" }}>
      <span style={{ color: "#888", minWidth: 80 }}>{label}</span>
      <span style={{ color: "#333", wordBreak: "break-word" }}>{children}</span>
    </div>
  );
}

export default function Operators({ session, isAdmin }) {
  const { t } = useT();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterQ, setFilterQ] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [expandedId, setExpandedId] = useState(null);
  const aliveRef = useRef(true);

  const accessToken = session?.access_token;

  const refresh = useCallback(async () => {
    if (!isAdmin || !accessToken) return;
    setLoading(true);
    setErr("");
    try {
      const qs = new URLSearchParams();
      if (filterStatus) qs.set("status", filterStatus);
      if (filterQ) qs.set("q", filterQ);
      qs.set("limit", "200");
      const data = await callOcppAdmin(`/operators?${qs}`, { accessToken });
      if (!aliveRef.current) return;
      setRows(Array.isArray(data?.data) ? data.data : []);
    } catch (e) {
      if (!aliveRef.current) return;
      setErr(String(e?.message || e));
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, [isAdmin, accessToken, filterStatus, filterQ]);

  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

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
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{t("運營商")}</h3>

        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid #ddd", fontSize: 13 }}>
          {STATUS_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>{t(label)}</option>
          ))}
        </select>

        <form
          onSubmit={(e) => { e.preventDefault(); setFilterQ(searchInput.trim()); }}
          style={{ display: "flex", gap: 6 }}
        >
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={t("運營商 / 公司 / 聯絡人")}
            style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid #ddd", fontSize: 13, width: 200 }}
          />
          <button type="submit" style={{ padding: "4px 14px", borderRadius: 6, border: "1px solid #1976d2", background: "#1976d2", color: "#fff", fontSize: 13, cursor: "pointer" }}>
            {t("搜尋")}
          </button>
        </form>

        <button onClick={refresh} disabled={loading} style={{ padding: "4px 12px", borderRadius: 6, border: "1px solid #ddd", background: loading ? "#f3f4f6" : "#fff", cursor: loading ? "default" : "pointer", fontSize: 13 }}>
          {loading ? t("載入中…") : t("刷新")}
        </button>

        <span style={{ marginLeft: "auto", fontSize: 12, color: "#888" }}>
          {t("共")} {rows.length} {t("條")}
        </span>
      </div>

      {err && (
        <div style={{ background: "#ffebee", border: "1px solid #ffcdd2", color: "#c62828", padding: "8px 12px", borderRadius: 6, fontSize: 13, marginBottom: 12 }}>
          {err}
        </div>
      )}

      {empty && (
        <div style={{ padding: 40, textAlign: "center", color: "#888", border: "1px dashed #ddd", borderRadius: 8 }}>
          {t("無運營商數據")}
        </div>
      )}

      {rows.length > 0 && (
        <div style={{ overflowX: "auto", border: "1px solid #eee", borderRadius: 8 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#fafafa", textAlign: "left" }}>
                {[t("運營商"), t("公司"), t("聯絡人"), t("電話"), t("狀態"), t("站數"), t("樁數"), t("操作")].map((h) => (
                  <th key={h} style={{ padding: "8px 10px", borderBottom: "1px solid #eee", fontWeight: 600, color: "#555" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const open = expandedId === r.operatorId;
                return (
                  <React.Fragment key={r.operatorId}>
                    <tr style={{ borderBottom: open ? "none" : "1px solid #f3f4f6" }}>
                      <td style={{ padding: "8px 10px", fontWeight: 500 }}>{r.name || "—"}</td>
                      <td style={{ padding: "8px 10px" }}>{r.companyName || "—"}</td>
                      <td style={{ padding: "8px 10px" }}>{r.contactName || "—"}</td>
                      <td style={{ padding: "8px 10px", fontFamily: "monospace", fontSize: 12 }}>{r.phone || "—"}</td>
                      <td style={{ padding: "8px 10px" }}><StatusChip status={r.status} t={t} /></td>
                      <td style={{ padding: "8px 10px", textAlign: "center" }}>{r.stationTotal ?? 0}</td>
                      <td style={{ padding: "8px 10px", textAlign: "center" }}>{r.pileTotal ?? 0}</td>
                      <td style={{ padding: "8px 10px" }}>
                        <button
                          onClick={() => setExpandedId(open ? null : r.operatorId)}
                          style={{ padding: "4px 10px", borderRadius: 4, border: "1px solid #e5e7eb", background: "#fff", color: "#1976d2", fontSize: 12, cursor: "pointer" }}
                        >
                          {open ? t("收起") : t("查看詳情")}
                        </button>
                      </td>
                    </tr>
                    {open && (
                      <tr style={{ borderBottom: "1px solid #f3f4f6", background: "#fcfcfd" }}>
                        <td colSpan={8} style={{ padding: "12px 16px" }}>
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "2px 24px" }}>
                            <DetailRow label={t("郵箱")}>{r.email || "—"}</DetailRow>
                            <DetailRow label={t("地址")}>{r.address || "—"}</DetailRow>
                            <DetailRow label={t("公司 ID")}>{r.companyId || "—"}</DetailRow>
                            <DetailRow label={t("賬戶餘額")}>HK$ {fmtMoney(r.money)}</DetailRow>
                            <DetailRow label={t("凍結金額")}>HK$ {fmtMoney(r.frozenAmount)}</DetailRow>
                            <DetailRow label={t("分成比例")}>{fmtMoney(r.profitPercent)}%</DetailRow>
                            <DetailRow label={t("創建時間")}>{fmtUnixTs(r.createdAt)}</DetailRow>
                            <DetailRow label={t("更新時間")}>{fmtUnixTs(r.updatedAt)}</DetailRow>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
