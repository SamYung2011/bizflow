import React, { useState, useEffect, useRef, useCallback } from "react";
import { useT } from "../../../i18n.jsx";
import { callOcppAdmin, fmtUnixTs } from "../../../lib/ocppAdmin.js";
import {
  fmtMoney, MoneyText, Chip, DetailRow, DetailGrid, DetailToggleButton,
  FilterBar, SearchBox, Select, ErrorBanner, EmptyState, Pager, TableHead,
  TABLE_WRAP_STYLE, TABLE_STYLE, TD_STYLE, MONO_TD_STYLE,
} from "./financeShared.jsx";

// 退款記錄 (Refunds) — chargecms finance/Refund 後台源自 rc_payment_orders（list 唯讀）
// PHP 後台固定 where state > 1；此頁保留 state filter 方便 admin 看未退款 / 等待中 / 失敗

const PAGE_LIMIT = 50;

const STATE_OPTIONS = [
  ["all", "全部狀態"],
  ["2", "退款失敗"],
  ["3", "未退款"],
  ["4", "退款等待中"],
];

const STATE_META = {
  failed: ["退款失敗", "red"],
  not_refunded: ["未退款", "gray"],
  pending_refund: ["退款等待中", "orange"],
};

function RefundStatusChip({ stateKey, state, t }) {
  const [label, tone] = STATE_META[stateKey] || [String(state ?? "—"), "gray"];
  return <Chip label={t(label)} tone={tone} />;
}

export default function Refunds({ session, isAdmin, active = true }) {
  const { t } = useT();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [filterState, setFilterState] = useState("all");
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
      if (filterState) qs.set("state", filterState);
      if (filterQ) qs.set("q", filterQ);
      qs.set("limit", String(PAGE_LIMIT));
      qs.set("offset", String(offset));
      const data = await callOcppAdmin(`/finance/refunds?${qs}`, { accessToken, force });
      if (!aliveRef.current) return;
      setRows(Array.isArray(data?.data) ? data.data : []);
      setHasMore(Boolean(data?.page?.hasMore));
    } catch (e) {
      if (!aliveRef.current) return;
      setErr(String(e?.message || e));
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, [isAdmin, accessToken, filterState, filterQ, offset]);

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
      <FilterBar title={t("退款記錄")} onRefresh={refresh} loading={loading} count={rows.length}>
        <Select value={filterState} options={STATE_OPTIONS} onChange={(v) => { setOffset(0); setFilterState(v); }} />
        <SearchBox
          value={searchInput}
          onChange={setSearchInput}
          onSubmit={() => { setOffset(0); setFilterQ(searchInput.trim()); }}
          placeholder={t("用戶ID / 郵箱 / 訂單號")}
        />
      </FilterBar>

      <ErrorBanner message={err} />
      {empty && <EmptyState message={t("無退款記錄")} />}

      {rows.length > 0 && (
        <>
          <div style={TABLE_WRAP_STYLE}>
            <table style={TABLE_STYLE}>
              <TableHead columns={[t("ID"), t("用戶"), { label: t("支付金額"), align: "right" }, { label: t("淨額"), align: "right" }, t("支付方式"), t("狀態"), t("支付日期"), t("操作")]} />
              <tbody>
                {rows.map((r) => {
                  const open = expandedId === r.orderId;
                  return (
                    <React.Fragment key={r.orderId}>
                      <tr style={{ borderBottom: open ? "none" : "1px solid #f3f4f6" }}>
                        <td style={MONO_TD_STYLE}>{r.orderId || "—"}</td>
                        <td style={TD_STYLE}>{r.nickname || r.username || r.email || r.userId || "—"}</td>
                        <td style={{ ...TD_STYLE, textAlign: "right" }}><MoneyText value={r.amount} /></td>
                        <td style={{ ...TD_STYLE, textAlign: "right" }}>HK$ {fmtMoney(r.netAmount)}</td>
                        <td style={TD_STYLE}>{r.paymentName || r.paymentMethod || "—"}</td>
                        <td style={TD_STYLE}><RefundStatusChip stateKey={r.stateKey} state={r.state} t={t} /></td>
                        <td style={TD_STYLE}>{r.localDate || fmtUnixTs(r.createdAt)}</td>
                        <td style={TD_STYLE}><DetailToggleButton open={open} onClick={() => setExpandedId(open ? null : r.orderId)} /></td>
                      </tr>
                      {open && (
                        <tr style={{ borderBottom: "1px solid #f3f4f6", background: "#fcfcfd" }}>
                          <td colSpan={8} style={{ padding: "12px 16px" }}>
                            <DetailGrid>
                              <DetailRow label={t("用戶ID")}>{r.userId || "—"}</DetailRow>
                              <DetailRow label={t("用戶名")}>{r.username || "—"}</DetailRow>
                              <DetailRow label={t("郵箱")}>{r.email || "—"}</DetailRow>
                              <DetailRow label={t("支付單號")}>{r.paymentNo || "—"}</DetailRow>
                              <DetailRow label={t("付款訂單號")}>{r.paymentOrderNo || "—"}</DetailRow>
                              <DetailRow label={t("交易號")}>{r.transactionId || "—"}</DetailRow>
                              <DetailRow label={t("充電訂單號")}>{r.chargeNo || "—"}</DetailRow>
                              <DetailRow label={t("槍號")}>{r.connectorNo ?? "—"}</DetailRow>
                              <DetailRow label={t("支付方式")}>{r.paymentMethod || r.paymentName || "—"}</DetailRow>
                              <DetailRow label={t("本地日期")}>{r.localDate || "—"}</DetailRow>
                              <DetailRow label={t("支付ID")}>{r.paymentId ?? "—"}</DetailRow>
                              <DetailRow label={t("支付卡ID")}>{r.paymentCardId ?? "—"}</DetailRow>
                              <DetailRow label={t("訂單類型")}>{r.orderType ?? "—"}</DetailRow>
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
