import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../../i18n.jsx";
import { callOcppAdmin } from "../../lib/ocppAdmin.js";
import {
  Chip, ErrorBanner, EmptyState, FilterBar, Select, TableHead,
  TABLE_WRAP_STYLE, TABLE_STYLE, TD_STYLE, MONO_TD_STYLE,
} from "./finance/financeShared.jsx";

// OCPP 消息流 — chargecms logs/Ocpp (`chargelogs.rc_logs_*`) 只讀查詢
// 零寫入 / 不發 OCPP 命令 / 不動 vendor 8081 / 不動 chargecms PHP
// 列表只取摘要，完整 data 需點開後單條查詢，避免首屏拉大 JSON。

const DEFAULT_LIMIT = 50;
const MAX_LIMIT_WITH_PILE = 200;
const MAX_LIMIT_WITHOUT_PILE = 20;
const MAX_WINDOW_WITH_PILE_HOURS = 24;
const MAX_WINDOW_WITHOUT_PILE_HOURS = 2;

const DIR_OPTIONS = [
  ["all", "全部方向"],
  ["in", "上行"],
  ["out", "下行"],
];

const LIMIT_OPTIONS = [
  ["20", "20 條"],
  ["50", "50 條"],
  ["100", "100 條"],
  ["200", "200 條"],
];

const HK_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Hong_Kong",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function toLocalInputValue(date) {
  const d = date instanceof Date ? date : new Date(date);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function inputToUnixSeconds(value) {
  if (!value) return null;
  const d = new Date(value);
  const ts = Math.floor(d.getTime() / 1000);
  return Number.isFinite(ts) ? ts : null;
}

function fmtHkTs(value) {
  if (value == null || value === "") return "—";
  let d;
  if (typeof value === "number" || /^\d+$/.test(String(value))) {
    const n = Number(value);
    d = new Date(n > 10_000_000_000 ? n : n * 1000);
  } else {
    d = new Date(value);
  }
  if (Number.isNaN(d.getTime())) return String(value);
  return HK_FORMATTER.format(d).replace(",", "");
}

function safeJsonParse(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function actionFromPayload(payload) {
  if (!Array.isArray(payload)) return "";
  if (payload[0] === 2 && typeof payload[2] === "string") return payload[2];
  if (payload[0] === 3) return "CALLRESULT";
  if (payload[0] === 4) return "CALLERROR";
  return "";
}

function actionFromPreview(preview) {
  return actionFromPayload(safeJsonParse(preview)) || "";
}

function prettyPayload(text) {
  const parsed = safeJsonParse(text);
  if (!parsed) return String(text || "");
  return JSON.stringify(parsed, null, 2);
}

function DirChip({ dir, t }) {
  const key = String(dir || "").toLowerCase();
  if (key === "in") return <Chip label={t("上行")} tone="blue" />;
  if (key === "out") return <Chip label={t("下行")} tone="gray" />;
  return <Chip label={dir || t("未知")} tone="gray" />;
}

function effectiveWindow({ pileNo, from, to, limit }) {
  const end = to || Math.floor(Date.now() / 1000);
  const maxHours = pileNo ? MAX_WINDOW_WITH_PILE_HOURS : MAX_WINDOW_WITHOUT_PILE_HOURS;
  const maxLimit = pileNo ? MAX_LIMIT_WITH_PILE : MAX_LIMIT_WITHOUT_PILE;
  const minFrom = end - maxHours * 3600;
  const start = from ? Math.max(from, minFrom) : minFrom;
  return {
    from: start,
    to: end,
    limit: Math.min(limit || DEFAULT_LIMIT, maxLimit),
    clampedWindow: Boolean(from && from < minFrom),
    clampedLimit: Boolean(limit && limit > maxLimit),
    maxHours,
    maxLimit,
  };
}

export default function OcppLogs({ session, isAdmin }) {
  const { t } = useT();
  const now = useMemo(() => new Date(), []);
  const [pileInput, setPileInput] = useState("");
  const [pileNo, setPileNo] = useState("");
  const [dir, setDir] = useState("all");
  const [fromInput, setFromInput] = useState(() => toLocalInputValue(new Date(now.getTime() - 60 * 60 * 1000)));
  const [toInput, setToInput] = useState(() => toLocalInputValue(now));
  const [limit, setLimit] = useState(DEFAULT_LIMIT);
  const [beforeId, setBeforeId] = useState("");
  const [cursorStack, setCursorStack] = useState([]);
  const [rows, setRows] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [details, setDetails] = useState({});
  const [detailLoadingId, setDetailLoadingId] = useState(null);
  const aliveRef = useRef(true);

  const accessToken = session?.access_token;

  const queryPlan = useMemo(() => effectiveWindow({
    pileNo: pileNo.trim(),
    from: inputToUnixSeconds(fromInput),
    to: inputToUnixSeconds(toInput),
    limit: Number(limit),
  }), [pileNo, fromInput, toInput, limit]);

  const refresh = useCallback(async ({ force = false } = {}) => {
    if (!isAdmin || !accessToken) return;
    setLoading(true);
    setErr("");
    try {
      if (queryPlan.from > queryPlan.to) {
        throw new Error(t("開始時間不能晚於結束時間"));
      }
      const qs = new URLSearchParams();
      if (pileNo.trim()) qs.set("pile_no", pileNo.trim());
      if (dir && dir !== "all") qs.set("dir", dir);
      qs.set("from", String(queryPlan.from));
      qs.set("to", String(queryPlan.to));
      qs.set("limit", String(queryPlan.limit));
      if (beforeId) qs.set("before_id", beforeId);
      const data = await callOcppAdmin(`/ocpp/logs?${qs}`, { accessToken, force, ttlMs: 0 });
      if (!aliveRef.current) return;
      setRows(Array.isArray(data?.data) ? data.data : []);
      setHasMore(Boolean(data?.page?.hasMore));
    } catch (e) {
      if (!aliveRef.current) return;
      setErr(String(e?.message || e));
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, [isAdmin, accessToken, pileNo, dir, queryPlan, beforeId, t]);

  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const applyFilters = (e) => {
    e.preventDefault();
    setBeforeId("");
    setCursorStack([]);
    setPileNo(pileInput.trim());
  };

  const loadDetail = async (row) => {
    const id = row?.id;
    if (!id || details[id]?.open) {
      setDetails((prev) => ({ ...prev, [id]: { ...(prev[id] || {}), open: false } }));
      return;
    }
    if (details[id]?.data) {
      setDetails((prev) => ({ ...prev, [id]: { ...prev[id], open: true } }));
      return;
    }
    setDetailLoadingId(id);
    try {
      const data = await callOcppAdmin(`/ocpp/logs/${encodeURIComponent(id)}`, { accessToken, force: true, ttlMs: 0 });
      setDetails((prev) => ({ ...prev, [id]: { open: true, data } }));
    } catch (e) {
      setDetails((prev) => ({ ...prev, [id]: { open: true, error: String(e?.message || e) } }));
    } finally {
      setDetailLoadingId(null);
    }
  };

  if (!isAdmin) {
    return <div style={{ padding: 40, textAlign: "center", color: "#999" }}>{t("無權訪問")}</div>;
  }

  const empty = !loading && !err && rows.length === 0;

  return (
    <div style={{ padding: "16px 20px", maxWidth: 1500 }}>
      <FilterBar title={t("OCPP 消息流")} onRefresh={refresh} loading={loading} count={rows.length}>
        <form onSubmit={applyFilters} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input
            value={pileInput}
            onChange={(e) => setPileInput(e.target.value)}
            placeholder={t("樁號")}
            style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid #ddd", fontSize: 13, width: 130 }}
          />
          <Select value={dir} options={DIR_OPTIONS} onChange={(v) => { setBeforeId(""); setCursorStack([]); setDir(v); }} />
          <input type="datetime-local" value={fromInput} onChange={(e) => { setBeforeId(""); setCursorStack([]); setFromInput(e.target.value); }} style={{ padding: "3px 8px", borderRadius: 6, border: "1px solid #ddd", fontSize: 13 }} />
          <input type="datetime-local" value={toInput} onChange={(e) => { setBeforeId(""); setCursorStack([]); setToInput(e.target.value); }} style={{ padding: "3px 8px", borderRadius: 6, border: "1px solid #ddd", fontSize: 13 }} />
          <Select value={String(limit)} options={LIMIT_OPTIONS} onChange={(v) => { setBeforeId(""); setCursorStack([]); setLimit(Number(v)); }} />
          <button type="submit" style={{ padding: "4px 14px", borderRadius: 6, border: "1px solid #1976d2", background: "#1976d2", color: "#fff", fontSize: 13, cursor: "pointer" }}>{t("搜尋")}</button>
        </form>
      </FilterBar>

      <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", color: "#1e40af", padding: "8px 12px", borderRadius: 6, fontSize: 12, marginBottom: 12 }}>
        {pileNo.trim()
          ? t("已限制單次查詢最多 24 小時，不做全量 count。")
          : t("未指定樁號時最多查 2 小時 / 20 條，避免掃大表。")}
        {(queryPlan.clampedWindow || queryPlan.clampedLimit) && (
          <span style={{ marginLeft: 8, fontWeight: 700 }}>
            {t("已自動套用安全上限")}
          </span>
        )}
      </div>

      <ErrorBanner message={err} />
      {empty && <EmptyState message={t("無 OCPP 消息流數據")} />}

      {rows.length > 0 && (
        <>
          <div style={TABLE_WRAP_STYLE}>
            <table style={TABLE_STYLE}>
              <TableHead columns={[
                t("時間"),
                t("方向"),
                t("樁號"),
                t("Action"),
                t("消息ID"),
                t("摘要"),
                t("詳情"),
              ]} />
              <tbody>
                {rows.map((r) => {
                  const id = r.id;
                  const action = r.action || actionFromPreview(r.data_preview || r.dataPreview);
                  const detail = details[id];
                  const dataText = detail?.data?.data ?? detail?.data?.fullData ?? detail?.data?.data_preview ?? detail?.data?.dataPreview;
                  return (
                    <React.Fragment key={id}>
                      <tr style={{ borderBottom: detail?.open ? "0" : "1px solid #f3f4f6" }}>
                        <td style={MONO_TD_STYLE}>{fmtHkTs(r.ts || r.date || r.createdAt)}</td>
                        <td style={TD_STYLE}><DirChip dir={r.dir} t={t} /></td>
                        <td style={MONO_TD_STYLE}>{r.pile_no || r.pileNo || "—"}</td>
                        <td style={MONO_TD_STYLE}>{action || "—"}</td>
                        <td style={MONO_TD_STYLE}>{r.message_id || r.messageId || "—"}</td>
                        <td style={{ ...TD_STYLE, maxWidth: 520, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {r.data_preview || r.dataPreview || "—"}
                        </td>
                        <td style={TD_STYLE}>
                          <button
                            type="button"
                            onClick={() => loadDetail(r)}
                            disabled={detailLoadingId === id}
                            style={{ padding: "4px 10px", borderRadius: 4, border: "1px solid #e5e7eb", background: "#fff", color: "#1976d2", fontSize: 12, cursor: "pointer" }}
                          >
                            {detailLoadingId === id ? t("載入中…") : detail?.open ? t("收起") : t("查看詳情")}
                          </button>
                        </td>
                      </tr>
                      {detail?.open && (
                        <tr>
                          <td colSpan={7} style={{ padding: 0, borderBottom: "1px solid #f3f4f6" }}>
                            <div style={{ background: "#f9fafb", padding: 12 }}>
                              {detail.error ? (
                                <div style={{ color: "#c62828", fontSize: 13 }}>{detail.error}</div>
                              ) : (
                                <>
                                  {detail?.data?.truncated && (
                                    <div style={{ color: "#9a3412", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 6, padding: "6px 8px", fontSize: 12, marginBottom: 8 }}>
                                      {t("完整消息過大，已截斷顯示。")}
                                    </div>
                                  )}
                                  <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 12, lineHeight: 1.5, maxHeight: 460, overflow: "auto" }}>
                                    {prettyPayload(dataText || r.data_preview || r.dataPreview)}
                                  </pre>
                                </>
                              )}
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
              onClick={() => {
                const nextStack = [...cursorStack];
                const prevBefore = nextStack.pop() || "";
                setCursorStack(nextStack);
                setBeforeId(prevBefore);
              }}
              disabled={loading || cursorStack.length === 0}
              style={{ padding: "4px 14px", borderRadius: 6, border: "1px solid #ddd", background: cursorStack.length === 0 ? "#f3f4f6" : "#fff", color: cursorStack.length === 0 ? "#aaa" : "#333", fontSize: 13, cursor: cursorStack.length === 0 ? "default" : "pointer" }}
            >
              {t("上一頁")}
            </button>
            <span style={{ fontSize: 12, color: "#888" }}>{beforeId ? `${t("游標")} #${beforeId}` : t("第一頁")}</span>
            <button
              onClick={() => {
                const lastId = rows[rows.length - 1]?.id;
                if (!lastId) return;
                setCursorStack((prev) => [...prev, beforeId]);
                setBeforeId(String(lastId));
              }}
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
