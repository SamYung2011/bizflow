import React, { useState, useEffect, useRef, useCallback } from "react";
import { useT } from "../../../i18n.jsx";
import { callOcppAdmin, fmtUnixTs } from "../../../lib/ocppAdmin.js";
import {
  fmtMoney, MoneyText, Chip, DetailRow, DetailGrid, DetailToggleButton,
  FilterBar, SearchBox, Select, ErrorBanner, EmptyState, Pager, TableHead,
  TABLE_WRAP_STYLE, TABLE_STYLE, TD_STYLE, MONO_TD_STYLE,
} from "./financeShared.jsx";

// 充值訂單 (Recharges) — chargecms rc_orders_recharge（list 唯讀）
// 支付方式名走後端 COALESCE(rc_payment.name, rc_finance_payment_method.name)
// chargecms PHP 後台只顯示 status=1（成功），此處默認看全部 + 狀態 filter

const PAGE_LIMIT = 50;

// chargecms PHP 老後台只展示 status=1（成功）；此頁默認全部 → 0=未完成待支付 / 1=成功
const STATUS_OPTIONS = [
  ["all", "全部狀態"],
  ["1", "成功"],
  ["0", "未完成待支付"],
];

function RechargeStatusChip({ status, t }) {
  const s = Number(status);
  if (s === 1) return <Chip label={t("成功")} tone="green" />;
  if (s === 0) return <Chip label={t("未完成待支付")} tone="gray" />;
  return <Chip label={String(status ?? 0)} tone="gray" />;
}

function pct(value, total) {
  if (!total) return "0.0%";
  return `${((value / total) * 100).toFixed(1)}%`;
}

function SummaryCard({ label, value, detail, tone = "neutral" }) {
  const styles = {
    neutral: { bg: "#f9fafb", border: "#e5e7eb", value: "#111827" },
    green: { bg: "#f0fdf4", border: "#bbf7d0", value: "#047857" },
    gray: { bg: "#f8fafc", border: "#e2e8f0", value: "#475569" },
  }[tone] || { bg: "#f9fafb", border: "#e5e7eb", value: "#111827" };
  return (
    <div style={{ minWidth: 160, flex: "1 1 160px", padding: "12px 14px", borderRadius: 8, border: `1px solid ${styles.border}`, background: styles.bg }}>
      <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 5 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: styles.value, lineHeight: 1 }}>{value}</div>
      {detail && <div style={{ fontSize: 12, color: "#6b7280", marginTop: 6 }}>{detail}</div>}
    </div>
  );
}

function RechargeSummary({ t, summary }) {
  if (!summary) return null;
  const total = Number(summary.total ?? 0);
  const success = Number(summary.success ?? 0);
  const pending = Number(summary.pending ?? 0);
  if (!Number.isFinite(total) || total <= 0) return null;
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
        <SummaryCard label={t("總單數")} value={total} tone="neutral" />
        <SummaryCard label={t("成功")} value={success} detail={pct(success, total)} tone="green" />
        <SummaryCard label={t("未完成待支付")} value={pending} detail={pct(pending, total)} tone="gray" />
      </div>
      <div style={{ padding: "8px 12px", borderRadius: 8, background: "#fff7ed", border: "1px solid #fed7aa", color: "#9a3412", fontSize: 13 }}>
        {t("未完成待支付包含重複嘗試、離開付款頁或未完成回調的訂單，不代表付款被拒或扣款異常。")}
      </div>
    </div>
  );
}

export default function Recharges({ session, isAdmin, active = true }) {
  const { t } = useT();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [filterStatus, setFilterStatus] = useState("1");
  const [filterQ, setFilterQ] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [summary, setSummary] = useState(null);
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
      if (filterStatus) qs.set("status", filterStatus);
      if (filterQ) qs.set("q", filterQ);
      qs.set("limit", String(PAGE_LIMIT));
      qs.set("offset", String(offset));
      const data = await callOcppAdmin(`/finance/recharges?${qs}`, { accessToken, force });
      if (!aliveRef.current) return;
      setRows(Array.isArray(data?.data) ? data.data : []);
      setHasMore(Boolean(data?.page?.hasMore));
      setSummary(data?.summary && typeof data.summary === "object" ? data.summary : null);
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
      <RechargeSummary t={t} summary={summary} />

      <FilterBar title={t("充值訂單")} onRefresh={refresh} loading={loading} count={rows.length}>
        <Select value={filterStatus} options={STATUS_OPTIONS} onChange={(v) => { setOffset(0); setFilterStatus(v); }} />
        <SearchBox
          value={searchInput}
          onChange={setSearchInput}
          onSubmit={() => { setOffset(0); setFilterQ(searchInput.trim()); }}
          placeholder={t("用戶ID / 郵箱 / 訂單號")}
        />
      </FilterBar>

      <ErrorBanner message={err} />
      {empty && <EmptyState message={t("無充值訂單")} />}

      {rows.length > 0 && (
        <>
          <div style={TABLE_WRAP_STYLE}>
            <table style={TABLE_STYLE}>
              <TableHead columns={[t("訂單號"), t("用戶"), { label: t("金額"), align: "right" }, t("支付方式"), t("狀態"), t("時間"), t("操作")]} />
              <tbody>
                {rows.map((r) => {
                  const open = expandedId === r.rechargeId;
                  return (
                    <React.Fragment key={r.rechargeId}>
                      <tr style={{ borderBottom: open ? "none" : "1px solid #f3f4f6" }}>
                        <td style={MONO_TD_STYLE}>{r.orderNo || "—"}</td>
                        <td style={TD_STYLE}>{r.nickname || r.username || r.email || r.userId || "—"}</td>
                        <td style={{ ...TD_STYLE, textAlign: "right" }}><MoneyText value={r.amount} /></td>
                        <td style={TD_STYLE}>{r.paymentName || "—"}</td>
                        <td style={TD_STYLE}><RechargeStatusChip status={r.status} t={t} /></td>
                        <td style={TD_STYLE}>{fmtUnixTs(r.createdAt)}</td>
                        <td style={TD_STYLE}><DetailToggleButton open={open} onClick={() => setExpandedId(open ? null : r.rechargeId)} /></td>
                      </tr>
                      {open && (
                        <tr style={{ borderBottom: "1px solid #f3f4f6", background: "#fcfcfd" }}>
                          <td colSpan={7} style={{ padding: "12px 16px" }}>
                            <DetailGrid>
                              <DetailRow label={t("用戶ID")}>{r.userId || "—"}</DetailRow>
                              <DetailRow label={t("用戶名")}>{r.username || "—"}</DetailRow>
                              <DetailRow label={t("郵箱")}>{r.email || "—"}</DetailRow>
                              <DetailRow label={t("贈送金額")}>HK$ {fmtMoney(r.giveAmount)}</DetailRow>
                              <DetailRow label={t("幣種")}>{r.currency || "—"}</DetailRow>
                              <DetailRow label={t("充值套餐")}>{r.goodsName || "—"}</DetailRow>
                              <DetailRow label={t("支付單號")}>{r.paymentNo || "—"}</DetailRow>
                              <DetailRow label={t("備註")}>{r.remark || "—"}</DetailRow>
                              <DetailRow label={t("創建時間")}>{fmtUnixTs(r.createdAt)}</DetailRow>
                              <DetailRow label={t("更新時間")}>{fmtUnixTs(r.updatedAt)}</DetailRow>
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
