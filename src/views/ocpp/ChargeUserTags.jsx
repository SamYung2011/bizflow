import React, { useState, useEffect, useRef, useCallback } from "react";
import { useT } from "../../i18n.jsx";
import { callOcppAdmin, fmtUnixTs } from "../../lib/ocppAdmin.js";
import { TableHead } from "./finance/financeShared.jsx";

// RFID 卡 (ChargeUserTags) — chargecms rc_user_tags（list 唯讀）
// chargecms 業務定義：公共桩刷卡用戶身份 = IdTag 來源
// PHP 文案 "RFID card has been used by other users"
// tag 字段 = MIFARE Classic UID（8 位 16 進制如 409F9362）
// 零寫入 / 不發 OCPP 命令 / 不動 vendor 8081 / 不動 chargecms PHP
// 公司內部後台 admin only：用戶業務字段全明文（煊煊拍板）；認證憑證後端不返
// 2026-06-05 立項：rc_user_tags 4 行真數據起步

const PAGE_LIMIT = 50;

const BIND_OPTIONS = [
  ["all", "全部綁定狀態"],
  ["bound", "已綁定"],
  ["unbound", "未綁定"],
];

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

function BindChip({ isBind, t }) {
  const bg = isBind ? "#dbeafe" : "#f3f4f6";
  const fg = isBind ? "#1e40af" : "#6b7280";
  return (
    <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 10, background: bg, color: fg, fontSize: 11, fontWeight: 600 }}>
      {isBind ? t("已綁定") : t("未綁定")}
    </span>
  );
}

export default function ChargeUserTags({ session, isAdmin }) {
  const { t } = useT();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [filterBind, setFilterBind] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterQ, setFilterQ] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const aliveRef = useRef(true);

  const accessToken = session?.access_token;

  const refresh = useCallback(async ({ force = false } = {}) => {
    if (!isAdmin || !accessToken) return;
    setLoading(true);
    setErr("");
    try {
      const qs = new URLSearchParams();
      if (filterBind) qs.set("bindStatus", filterBind);
      if (filterStatus) qs.set("status", filterStatus);
      if (filterQ) qs.set("q", filterQ);
      qs.set("limit", String(PAGE_LIMIT));
      qs.set("offset", String(offset));
      const data = await callOcppAdmin(`/charge-user-tags?${qs}`, { accessToken, force });
      if (!aliveRef.current) return;
      setRows(Array.isArray(data?.data) ? data.data : []);
      setHasMore(Boolean(data?.page?.hasMore));
    } catch (e) {
      if (!aliveRef.current) return;
      setErr(String(e?.message || e));
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, [isAdmin, accessToken, filterBind, filterStatus, filterQ, offset]);

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
  const rangeStart = rows.length ? offset + 1 : 0;
  const rangeEnd = offset + rows.length;

  return (
    <div style={{ padding: "16px 20px", maxWidth: 1400 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{t("RFID 卡")}</h3>

        <select value={filterBind} onChange={(e) => { setOffset(0); setFilterBind(e.target.value); }} style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid #ddd", fontSize: 13 }}>
          {BIND_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>{t(label)}</option>
          ))}
        </select>

        <select value={filterStatus} onChange={(e) => { setOffset(0); setFilterStatus(e.target.value); }} style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid #ddd", fontSize: 13 }}>
          {STATUS_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>{t(label)}</option>
          ))}
        </select>

        <form
          onSubmit={(e) => { e.preventDefault(); setOffset(0); setFilterQ(searchInput.trim()); }}
          style={{ display: "flex", gap: 6 }}
        >
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={t("卡號 / 卡名 / 用戶ID / 郵箱 / 暱稱")}
            style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid #ddd", fontSize: 13, width: 260 }}
          />
          <button type="submit" style={{ padding: "4px 14px", borderRadius: 6, border: "1px solid #1976d2", background: "#1976d2", color: "#fff", fontSize: 13, cursor: "pointer" }}>
            {t("搜尋")}
          </button>
        </form>

        <button onClick={() => refresh({ force: true })} disabled={loading} style={{ padding: "4px 12px", borderRadius: 6, border: "1px solid #ddd", background: loading ? "#f3f4f6" : "#fff", cursor: loading ? "default" : "pointer", fontSize: 13 }}>
          {loading ? t("載入中…") : t("刷新")}
        </button>

        <span style={{ marginLeft: "auto", fontSize: 12, color: "#888" }}>
          {rangeStart}-{rangeEnd}
        </span>
      </div>

      <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", color: "#1e40af", padding: "8px 12px", borderRadius: 6, fontSize: 12, marginBottom: 12 }}>
        {t("RFID 卡 = 公共樁刷卡用戶身份（IdTag 來源）。卡號為 MIFARE Classic UID（8 位 16 進制）。")}
      </div>

      {err && (
        <div style={{ background: "#ffebee", border: "1px solid #ffcdd2", color: "#c62828", padding: "8px 12px", borderRadius: 6, fontSize: 13, marginBottom: 12 }}>
          {err}
        </div>
      )}

      {empty && (
        <div style={{ padding: 40, textAlign: "center", color: "#888", border: "1px dashed #ddd", borderRadius: 8 }}>
          {t("無 RFID 卡數據")}
        </div>
      )}

      {rows.length > 0 && (
        <>
          <div style={{ overflowX: "auto", border: "1px solid #eee", borderRadius: 8 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <TableHead columns={[t("卡號"), t("卡名"), t("綁定用戶"), t("郵箱"), t("運營商"), t("充電站"), t("綁定"), t("狀態"), t("創建時間")]} />
              <tbody>
                {rows.map((r) => (
                  <tr key={r.tagId} style={{ borderBottom: "1px solid #f3f4f6" }}>
                    <td style={{ padding: "8px 10px", fontFamily: "monospace", fontSize: 12 }}>{r.tag || "—"}</td>
                    <td style={{ padding: "8px 10px" }}>{r.name || "—"}</td>
                    <td style={{ padding: "8px 10px", fontFamily: "monospace", fontSize: 12 }}>
                      {r.userId ? (r.userNickname || r.userUsername || r.userId) : "—"}
                    </td>
                    <td style={{ padding: "8px 10px" }}>{r.userEmail || "—"}</td>
                    <td style={{ padding: "8px 10px" }}>{r.operatorName || (r.operatorId ? `#${r.operatorId}` : "—")}</td>
                    <td style={{ padding: "8px 10px" }}>{r.stationName || (r.stationId ? `#${r.stationId}` : "—")}</td>
                    <td style={{ padding: "8px 10px" }}><BindChip isBind={r.isBind} t={t} /></td>
                    <td style={{ padding: "8px 10px" }}><StatusChip status={r.status} t={t} /></td>
                    <td style={{ padding: "8px 10px", color: "#888", fontSize: 12 }}>{fmtUnixTs(r.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 12, marginTop: 12 }}>
            <button
              onClick={() => setOffset((o) => Math.max(0, o - PAGE_LIMIT))}
              disabled={loading || offset === 0}
              style={{ padding: "4px 14px", borderRadius: 6, border: "1px solid #ddd", background: offset === 0 ? "#f3f4f6" : "#fff", color: offset === 0 ? "#aaa" : "#333", fontSize: 13, cursor: offset === 0 ? "default" : "pointer" }}
            >
              {t("上一頁")}
            </button>
            <span style={{ fontSize: 12, color: "#888" }}>{rangeStart}-{rangeEnd}</span>
            <button
              onClick={() => setOffset((o) => o + PAGE_LIMIT)}
              disabled={loading || !hasMore}
              style={{ padding: "4px 14px", borderRadius: 6, border: "1px solid #ddd", background: !hasMore ? "#f3f4f6" : "#fff", color: !hasMore ? "#aaa" : "#333", fontSize: 13, cursor: !hasMore ? "default" : "pointer" }}
            >
              {t("下一頁")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
