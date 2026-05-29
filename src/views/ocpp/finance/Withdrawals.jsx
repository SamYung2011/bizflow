import React, { useState, useEffect, useRef, useCallback } from "react";
import { useT } from "../../../i18n.jsx";
import { callOcppAdmin, fmtUnixTs } from "../../../lib/ocppAdmin.js";
import {
  MoneyText, Chip, DetailRow, DetailGrid, DetailToggleButton,
  FilterBar, SearchBox, Select, ErrorBanner, EmptyState, Pager, TableHead,
  TABLE_WRAP_STYLE, TABLE_STYLE, TD_STYLE, MONO_TD_STYLE,
} from "./financeShared.jsx";

// 提現 (Withdrawals) — chargecms rc_finance_withdraw + rc_finance_withdraw_account（list 唯讀）
// 銀行賬號等業務字段全明文展示（admin only 內部後台，煊煊拍板）
// 提現表無 account_id 外鍵，賬戶模板走 operator_id+bank_account+bank_code best-effort 關聯（後端標注）

const PAGE_LIMIT = 50;

const STATUS_OPTIONS = [
  ["all", "全部狀態"],
  ["0", "申請中"],
  ["1", "已審核"],
  ["2", "已轉賬"],
  ["3", "已駁回"],
];

const STATUS_META = {
  apply: ["申請中", "blue"],
  reviewed: ["已審核", "orange"],
  transferred: ["已轉賬", "green"],
  reject: ["已駁回", "red"],
};

function WithdrawalStatusChip({ statusKey, t }) {
  const [label, tone] = STATUS_META[statusKey] || ["未知", "gray"];
  return <Chip label={t(label)} tone={tone} />;
}

export default function Withdrawals({ session, isAdmin, active = true }) {
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
      const data = await callOcppAdmin(`/finance/withdrawals?${qs}`, { accessToken, force });
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
      <FilterBar title={t("提現")} onRefresh={refresh} loading={loading} count={rows.length}>
        <Select value={filterStatus} options={STATUS_OPTIONS} onChange={(v) => { setOffset(0); setFilterStatus(v); }} />
        <SearchBox
          value={searchInput}
          onChange={setSearchInput}
          onSubmit={() => { setOffset(0); setFilterQ(searchInput.trim()); }}
          placeholder={t("運營商 / 銀行 / 賬號")}
        />
      </FilterBar>

      <ErrorBanner message={err} />
      {empty && <EmptyState message={t("無提現記錄")} />}

      {rows.length > 0 && (
        <>
          <div style={TABLE_WRAP_STYLE}>
            <table style={TABLE_STYLE}>
              <TableHead columns={[t("運營商"), { label: t("金額"), align: "right" }, t("銀行"), t("賬號"), t("狀態"), t("時間"), t("操作")]} />
              <tbody>
                {rows.map((r) => {
                  const open = expandedId === r.withdrawalId;
                  return (
                    <React.Fragment key={r.withdrawalId}>
                      <tr style={{ borderBottom: open ? "none" : "1px solid #f3f4f6" }}>
                        <td style={TD_STYLE}>{r.operatorName || "—"}</td>
                        <td style={{ ...TD_STYLE, textAlign: "right" }}><MoneyText value={r.amount} /></td>
                        <td style={TD_STYLE}>{r.bankName || "—"}</td>
                        <td style={MONO_TD_STYLE}>{r.bankAccount || "—"}</td>
                        <td style={TD_STYLE}><WithdrawalStatusChip statusKey={r.statusKey} t={t} /></td>
                        <td style={TD_STYLE}>{fmtUnixTs(r.createdAt)}</td>
                        <td style={TD_STYLE}><DetailToggleButton open={open} onClick={() => setExpandedId(open ? null : r.withdrawalId)} /></td>
                      </tr>
                      {open && (
                        <tr style={{ borderBottom: "1px solid #f3f4f6", background: "#fcfcfd" }}>
                          <td colSpan={7} style={{ padding: "12px 16px" }}>
                            <DetailGrid>
                              <DetailRow label={t("運營商ID")}>{r.operatorId || "—"}</DetailRow>
                              <DetailRow label={t("開戶行")}>{r.bankName || "—"}</DetailRow>
                              <DetailRow label={t("開戶地址")}>{r.bankAddress || "—"}</DetailRow>
                              <DetailRow label={t("銀行賬號")}>{r.bankAccount || "—"}</DetailRow>
                              <DetailRow label={t("銀行代碼")}>{r.bankCode || "—"}</DetailRow>
                              <DetailRow label={t("賬戶狀態")}>{r.accountStatus || "—"}</DetailRow>
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
