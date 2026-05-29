import React, { useState, useEffect, useRef, useCallback } from "react";
import { useT } from "../../../i18n.jsx";
import { callOcppAdmin, fmtUnixTs } from "../../../lib/ocppAdmin.js";
import {
  MoneyText, DetailRow, DetailGrid, DetailToggleButton,
  FilterBar, SearchBox, ErrorBanner, EmptyState, Pager, TableHead,
  TABLE_WRAP_STYLE, TABLE_STYLE, TD_STYLE, MONO_TD_STYLE,
} from "./financeShared.jsx";

// 平台流水 (PlatformMoneyLogs) — chargecms rc_platform_money_log（list 唯讀，303 條）
// 平台收入流水，無 type / before / after 字段；money 正負染色

const PAGE_LIMIT = 50;

export default function PlatformMoneyLogs({ session, isAdmin, active = true }) {
  const { t } = useT();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
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
      if (filterQ) qs.set("q", filterQ);
      qs.set("limit", String(PAGE_LIMIT));
      qs.set("offset", String(offset));
      const data = await callOcppAdmin(`/finance/platform-money-logs?${qs}`, { accessToken, force });
      if (!aliveRef.current) return;
      setRows(Array.isArray(data?.data) ? data.data : []);
      setHasMore(Boolean(data?.page?.hasMore));
    } catch (e) {
      if (!aliveRef.current) return;
      setErr(String(e?.message || e));
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, [isAdmin, accessToken, filterQ, offset]);

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
      <FilterBar title={t("平台流水")} onRefresh={refresh} loading={loading} count={rows.length}>
        <SearchBox
          value={searchInput}
          onChange={setSearchInput}
          onSubmit={() => { setOffset(0); setFilterQ(searchInput.trim()); }}
          placeholder={t("編號 / 訂單號 / 運營商 / 備註")}
          width={240}
        />
      </FilterBar>

      <ErrorBanner message={err} />
      {empty && <EmptyState message={t("無流水數據")} />}

      {rows.length > 0 && (
        <>
          <div style={TABLE_WRAP_STYLE}>
            <table style={TABLE_STYLE}>
              <TableHead columns={[t("運營商"), { label: t("金額"), align: "right" }, t("關聯訂單"), t("備註"), t("時間"), t("操作")]} />
              <tbody>
                {rows.map((r) => {
                  const open = expandedId === r.logId;
                  return (
                    <React.Fragment key={r.logId}>
                      <tr style={{ borderBottom: open ? "none" : "1px solid #f3f4f6" }}>
                        <td style={TD_STYLE}>{r.operatorName || "—"}</td>
                        <td style={{ ...TD_STYLE, textAlign: "right" }}><MoneyText value={r.money} /></td>
                        <td style={MONO_TD_STYLE}>{r.orderId || "—"}</td>
                        <td style={TD_STYLE}>{r.memo || "—"}</td>
                        <td style={TD_STYLE}>{fmtUnixTs(r.createdAt)}</td>
                        <td style={TD_STYLE}><DetailToggleButton open={open} onClick={() => setExpandedId(open ? null : r.logId)} /></td>
                      </tr>
                      {open && (
                        <tr style={{ borderBottom: "1px solid #f3f4f6", background: "#fcfcfd" }}>
                          <td colSpan={6} style={{ padding: "12px 16px" }}>
                            <DetailGrid>
                              <DetailRow label={t("流水編號")}>{r.logId ?? "—"}</DetailRow>
                              <DetailRow label={t("運營商ID")}>{r.operatorId || "—"}</DetailRow>
                              <DetailRow label={t("關聯訂單")}>{r.orderId || "—"}</DetailRow>
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
