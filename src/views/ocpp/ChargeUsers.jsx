import React, { useState, useEffect, useRef, useCallback } from "react";
import { useT } from "../../i18n.jsx";
import { callOcppAdmin, fmtUnixTs } from "../../lib/ocppAdmin.js";
import { TableHead } from "./finance/financeShared.jsx";

// 用戶信息 (ChargeUsers) — chargecms rc_user 主表 + rc_user_1..10 分表（list 唯讀）
// 零寫入 / 不發 OCPP 命令 / 不動 vendor 8081 / 不動 chargecms PHP
// 公司內部後台 admin only：用戶業務字段全明文（煊煊拍板）；認證憑證後端不返
// chargecms 用戶體系靠 user_id(openid) + email + 暱稱 標識，不收集 mobile/operator_id
// （這倆字段全表幾乎全空，chargecms PHP 後台 searchFields 也只用 user_id,email）→ 列表不展示
// 1556 用戶 → 分頁 UI（limit 50 翻頁）

const PAGE_LIMIT = 50;

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

// decimal 金額字段（mysql2 返字符串）→ 2 位小數
function fmtMoney(v) {
  if (v == null || v === "") return "0.00";
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : String(v);
}

// fastadmin gender 慣例：0 保密 / 1 男 / 2 女
function fmtGender(g, t) {
  const n = Number(g);
  if (n === 1) return t("男");
  if (n === 2) return t("女");
  return t("保密");
}

function DetailRow({ label, children }) {
  return (
    <div style={{ display: "flex", gap: 8, fontSize: 13, padding: "3px 0" }}>
      <span style={{ color: "#888", minWidth: 72 }}>{label}</span>
      <span style={{ color: "#333", wordBreak: "break-word" }}>{children}</span>
    </div>
  );
}

export default function ChargeUsers({ session, isAdmin }) {
  const { t } = useT();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterQ, setFilterQ] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const aliveRef = useRef(true);

  const accessToken = session?.access_token;

  const refresh = useCallback(async ({ force = false } = {}) => {
    if (!isAdmin || !accessToken) return;
    setLoading(true);
    setErr("");
    try {
      const qs = new URLSearchParams();
      if (filterStatus) qs.set("status", filterStatus);
      if (filterQ) qs.set("q", filterQ);
      qs.set("limit", String(PAGE_LIMIT));
      qs.set("offset", String(offset));
      const data = await callOcppAdmin(`/charge-users?${qs}`, { accessToken, force });
      if (!aliveRef.current) return;
      setRows(Array.isArray(data?.data) ? data.data : []);
      setHasMore(Boolean(data?.page?.hasMore));
    } catch (e) {
      if (!aliveRef.current) return;
      setErr(String(e?.message || e));
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, [isAdmin, accessToken, filterStatus, filterQ, offset]);

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
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{t("用戶信息")}</h3>

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
            placeholder={t("用戶ID / 郵箱 / 暱稱")}
            style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid #ddd", fontSize: 13, width: 220 }}
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

      {err && (
        <div style={{ background: "#ffebee", border: "1px solid #ffcdd2", color: "#c62828", padding: "8px 12px", borderRadius: 6, fontSize: 13, marginBottom: 12 }}>
          {err}
        </div>
      )}

      {empty && (
        <div style={{ padding: 40, textAlign: "center", color: "#888", border: "1px dashed #ddd", borderRadius: 8 }}>
          {t("無用戶數據")}
        </div>
      )}

      {rows.length > 0 && (
        <>
          <div style={{ overflowX: "auto", border: "1px solid #eee", borderRadius: 8 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <TableHead columns={[t("用戶ID"), t("郵箱"), t("暱稱"), { label: t("餘額"), align: "right" }, t("狀態"), t("操作")]} />
              <tbody>
                {rows.map((r) => {
                  const open = expandedId === r.userId;
                  return (
                    <React.Fragment key={r.userId || r.rowId}>
                      <tr style={{ borderBottom: open ? "none" : "1px solid #f3f4f6" }}>
                        <td style={{ padding: "8px 10px", fontFamily: "monospace", fontSize: 12 }}>{r.userId || "—"}</td>
                        <td style={{ padding: "8px 10px" }}>{r.email || "—"}</td>
                        <td style={{ padding: "8px 10px" }}>{r.nickname || r.username || "—"}</td>
                        <td style={{ padding: "8px 10px", textAlign: "right" }}>HK$ {fmtMoney(r.money)}</td>
                        <td style={{ padding: "8px 10px" }}><StatusChip status={r.status} t={t} /></td>
                        <td style={{ padding: "8px 10px" }}>
                          <button
                            onClick={() => setExpandedId(open ? null : r.userId)}
                            style={{ padding: "4px 10px", borderRadius: 4, border: "1px solid #e5e7eb", background: "#fff", color: "#1976d2", fontSize: 12, cursor: "pointer" }}
                          >
                            {open ? t("收起") : t("查看詳情")}
                          </button>
                        </td>
                      </tr>
                      {open && (
                        <tr style={{ borderBottom: "1px solid #f3f4f6", background: "#fcfcfd" }}>
                          <td colSpan={6} style={{ padding: "12px 16px" }}>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "2px 24px" }}>
                              <DetailRow label={t("用戶名")}>{r.username || "—"}</DetailRow>
                              <DetailRow label="tagid">{r.tagid || "—"}</DetailRow>
                              <DetailRow label={t("用戶組")}>{r.groupName || "—"}</DetailRow>
                              <DetailRow label={t("等級")}>{r.level ?? 0}</DetailRow>
                              <DetailRow label={t("性別")}>{fmtGender(r.gender, t)}</DetailRow>
                              <DetailRow label={t("生日")}>{r.birthday || "—"}</DetailRow>
                              <DetailRow label={t("地址")}>{r.address || "—"}</DetailRow>
                              <DetailRow label={t("收入")}>HK$ {fmtMoney(r.income)}</DetailRow>
                              <DetailRow label={t("積分")}>{r.score ?? 0}</DetailRow>
                              <DetailRow label={t("登錄IP")}>{r.loginip || "—"}</DetailRow>
                              <DetailRow label={t("註冊IP")}>{r.joinip || "—"}</DetailRow>
                              <DetailRow label={t("最後登錄")}>{fmtUnixTs(r.lastLoginAt)}</DetailRow>
                              <DetailRow label={t("註冊時間")}>{fmtUnixTs(r.joinedAt)}</DetailRow>
                              <DetailRow label={t("創建時間")}>{fmtUnixTs(r.createdAt)}</DetailRow>
                              {r.bio ? <DetailRow label={t("簡介")}>{r.bio}</DetailRow> : null}
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
