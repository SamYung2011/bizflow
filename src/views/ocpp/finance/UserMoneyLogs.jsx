import React, { useState, useEffect, useRef, useCallback } from "react";
import { useT } from "../../../i18n.jsx";
import { callOcppAdmin, fmtUnixTs } from "../../../lib/ocppAdmin.js";
import {
  fmtMoney, MoneyText, flowTone, Chip, DetailRow, DetailGrid, DetailToggleButton,
  FilterBar, SearchBox, Select, ErrorBanner, EmptyState, Pager, TableHead,
  TABLE_WRAP_STYLE, TABLE_STYLE, TD_STYLE, MONO_TD_STYLE,
} from "./financeShared.jsx";

// 用戶錢包流水 (UserMoneyLogs) — chargecms rc_user_money_log（list 唯讀，760 條）
// type 1=充值 / 2=消費 / 3=退款（後端透傳 typeKey）；money 正負染色

const PAGE_LIMIT = 50;

const TYPE_OPTIONS = [
  ["all", "全部類型"],
  ["1", "充值"],
  ["2", "消費"],
  ["3", "退款"],
];

const TYPE_META = {
  recharge: ["充值", "green"],
  consume: ["消費", "red"],
  refund: ["退款", "orange"],
};

function TypeChip({ typeKey, t }) {
  const [label, tone] = TYPE_META[typeKey] || ["未知", "gray"];
  return <Chip label={t(label)} tone={tone} />;
}

export default function UserMoneyLogs({ session, isAdmin, active = true }) {
  const { t } = useT();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [filterQ, setFilterQ] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const aliveRef = useRef(true);
  const wasActiveRef = useRef(active);

  const accessToken = session?.access_token;

  const refresh = useCallback(async ({ force = false } = {}) => {
    if (!isAdmin || !accessToken) return;
    setLoading(true);
    setErr("");
    try {
      const qs = new URLSearchParams();
      if (filterType) qs.set("type", filterType);
      if (filterQ) qs.set("q", filterQ);
      qs.set("limit", String(PAGE_LIMIT));
      qs.set("offset", String(offset));
      const data = await callOcppAdmin(`/finance/user-money-logs?${qs}`, { accessToken, force });
      if (!aliveRef.current) return;
      setRows(Array.isArray(data?.data) ? data.data : []);
      setHasMore(Boolean(data?.page?.hasMore));
    } catch (e) {
      if (!aliveRef.current) return;
      setErr(String(e?.message || e));
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, [isAdmin, accessToken, filterType, filterQ, offset]);

  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (active && !wasActiveRef.current) refresh();
    wasActiveRef.current = active;
  }, [active, refresh]);

  if (!isAdmin) {
    return <div style={{ padding: 40, textAlign: "center", color: "#999" }}>{t("無權訪問")}</div>;
  }

  const empty = !loading && !err && rows.length === 0;

  return (
    <div>
      <FilterBar title={t("用戶錢包流水")} onRefresh={refresh} loading={loading} count={rows.length}>
        <Select value={filterType} options={TYPE_OPTIONS} onChange={(v) => { setOffset(0); setFilterType(v); }} />
        <SearchBox
          value={searchInput}
          onChange={setSearchInput}
          onSubmit={() => { setOffset(0); setFilterQ(searchInput.trim()); }}
          placeholder={t("用戶ID / 郵箱 / 備註")}
        />
      </FilterBar>

      <ErrorBanner message={err} />
      {empty && <EmptyState message={t("無流水數據")} />}

      {rows.length > 0 && (
        <>
          <div style={TABLE_WRAP_STYLE}>
            <table style={TABLE_STYLE}>
              <TableHead columns={[t("類型"), t("用戶"), t("金額"), t("變動後餘額"), t("備註"), t("時間"), t("操作")]} />
              <tbody>
                {rows.map((r) => {
                  const open = expandedId === r.logId;
                  return (
                    <React.Fragment key={r.logId}>
                      <tr style={{ borderBottom: open ? "none" : "1px solid #f3f4f6" }}>
                        <td style={TD_STYLE}><TypeChip typeKey={r.typeKey} t={t} /></td>
                        <td style={TD_STYLE}>{r.nickname || r.username || r.email || r.userId || "—"}</td>
                        <td style={{ ...TD_STYLE, textAlign: "right" }}><MoneyText value={r.money} tone={flowTone(r.typeKey)} /></td>
                        <td style={{ ...TD_STYLE, textAlign: "right" }}>HK$ {fmtMoney(r.afterMoney)}</td>
                        <td style={TD_STYLE}>{r.memo || "—"}</td>
                        <td style={TD_STYLE}>{fmtUnixTs(r.createdAt)}</td>
                        <td style={TD_STYLE}><DetailToggleButton open={open} onClick={() => setExpandedId(open ? null : r.logId)} /></td>
                      </tr>
                      {open && (
                        <tr style={{ borderBottom: "1px solid #f3f4f6", background: "#fcfcfd" }}>
                          <td colSpan={7} style={{ padding: "12px 16px" }}>
                            <DetailGrid>
                              <DetailRow label={t("用戶ID")}>{r.userId || "—"}</DetailRow>
                              <DetailRow label={t("用戶名")}>{r.username || "—"}</DetailRow>
                              <DetailRow label={t("郵箱")}>{r.email || "—"}</DetailRow>
                              <DetailRow label={t("變動前餘額")}>HK$ {fmtMoney(r.beforeMoney)}</DetailRow>
                              <DetailRow label={t("變動後餘額")}>HK$ {fmtMoney(r.afterMoney)}</DetailRow>
                              <DetailRow label={t("退款單號")}>{r.refundOrderNo || "—"}</DetailRow>
                              <DetailRow label={t("關聯訂單")}>{r.orderId || "—"}</DetailRow>
                              <DetailRow label="tagid">{r.userTag || r.userTagId || "—"}</DetailRow>
                              <DetailRow label={t("創建時間")}>{fmtUnixTs(r.createdAt)}</DetailRow>
                            </DetailGrid>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
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
