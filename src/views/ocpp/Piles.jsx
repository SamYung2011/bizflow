import React, { useState, useEffect, useRef, useCallback } from "react";
import { useT } from "../../i18n.jsx";
import { callOcppAdmin } from "../../lib/ocppAdmin.js";
import {
  Chip,
  ErrorBanner,
  EmptyState,
  FilterBar,
  Pager,
  SearchBox,
  Select,
  TableHead,
  TABLE_WRAP_STYLE,
  TABLE_STYLE,
  TD_STYLE,
  MONO_TD_STYLE,
} from "./finance/financeShared.jsx";

// 充電桩 — 公共桩 + 私人桩 + 未分配桩統一列表（2026-06-10 nav 重构合并 PublicPiles/PrivatePiles）。
// 走 readapi /piles 統一接口，服務端筛选 + 分頁（舊公共桩页是拉 200 條前端搜，行為一并統一）。
// 「未分配」= station_id=0 且 is_share=0，舊兩页都看不到的洞从这里補上。

const PAGE_LIMIT = 50;

const PILE_TYPE_OPTIONS = [
  { value: "all", labelKey: "全部類型" },
  { value: "public", labelKey: "公共桩" },
  { value: "private", labelKey: "私人桩" },
  { value: "unassigned", labelKey: "未分配桩" },
];

function pileTypeChip(pileType, t) {
  if (pileType === "public") return <Chip label={t("公共")} tone="blue" />;
  if (pileType === "private") return <Chip label={t("私人")} tone="green" />;
  return <Chip label={t("未分配")} tone="orange" />;
}

function PileStatusChip({ onlineStatus, faultCount, t }) {
  if (onlineStatus === 0) {
    return <span style={chipStyle("#ffebee", "#ef4444", "#ffcdd2")}>{t("離線")}</span>;
  }
  if (faultCount > 0) {
    return <span style={chipStyle("#fff3e0", "#f57c00", "#ffcc80")}>{t("故障")} {faultCount}</span>;
  }
  return <span style={chipStyle("#e8f5e9", "#22c55e", "#a5d6a7")}>{t("在線")}</span>;
}

function chipStyle(bg, color, border) {
  return {
    display: "inline-block", padding: "2px 8px", borderRadius: 999,
    background: bg, color, border: `1px solid ${border}`,
    fontSize: 12, fontWeight: 600,
  };
}

export default function Piles({ session, isAdmin, active = true }) {
  const { t } = useT();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [pileType, setPileType] = useState("all");
  const [searchInput, setSearchInput] = useState("");
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const aliveRef = useRef(true);
  const wasActiveRef = useRef(active);
  const accessToken = session?.access_token;

  const refresh = useCallback(async ({ force = false } = {}) => {
    if (!isAdmin || !accessToken) return;
    setLoading(true);
    setErr("");
    try {
      const qs = new URLSearchParams();
      if (pileType !== "all") qs.set("pileType", pileType);
      if (q) qs.set("q", q);
      qs.set("limit", String(PAGE_LIMIT));
      qs.set("offset", String(offset));
      const data = await callOcppAdmin(`/piles?${qs}`, { accessToken, force });
      if (!aliveRef.current) return;
      setRows(Array.isArray(data?.data) ? data.data : []);
      setHasMore(Boolean(data?.page?.hasMore));
    } catch (e) {
      if (!aliveRef.current) return;
      setErr(String(e?.message || e));
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, [isAdmin, accessToken, pileType, q, offset]);

  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (active && !wasActiveRef.current) refresh();
    wasActiveRef.current = active;
  }, [active, refresh]);

  if (!isAdmin) return null;

  const empty = !loading && !err && rows.length === 0;

  return (
    <div>
      <FilterBar title={t("充電桩")} onRefresh={refresh} loading={loading} count={rows.length}>
        <Select
          value={pileType}
          onChange={(v) => { setOffset(0); setPileType(v); }}
          options={PILE_TYPE_OPTIONS.map((o) => [o.value, o.labelKey])}
        />
        <SearchBox
          value={searchInput}
          onChange={setSearchInput}
          onSubmit={() => { setOffset(0); setQ(searchInput.trim()); }}
          placeholder={t("搜索桩編號 / 名稱 / 品牌 / 序列號 / 站點")}
          width={280}
        />
      </FilterBar>
      <ErrorBanner message={err} />
      {empty && <EmptyState message={t("無數據")} />}
      {rows.length > 0 && (
        <>
          <div style={TABLE_WRAP_STYLE}>
            <table style={TABLE_STYLE}>
              <TableHead columns={[
                t("樁編號"),
                t("類型"),
                t("名稱"),
                t("品牌"),
                t("型號"),
                t("固件"),
                t("序列號"),
                t("所屬站點"),
                t("運營商"),
                t("狀態"),
                t("槍數"),
              ]} />
              <tbody>
                {rows.map((p) => (
                  <tr key={p.pileId} style={{ borderBottom: "1px solid #f3f4f6" }}>
                    <td style={MONO_TD_STYLE}>{p.pileNo || "—"}</td>
                    <td style={TD_STYLE}>{pileTypeChip(p.pileType, t)}</td>
                    <td style={TD_STYLE}>{p.name || "—"}</td>
                    <td style={TD_STYLE}>{p.vendor || "—"}</td>
                    <td style={TD_STYLE}>{p.model || "—"}</td>
                    <td style={{ ...MONO_TD_STYLE, color: "#666" }}>{p.firmwareVersion || "—"}</td>
                    <td style={{ ...MONO_TD_STYLE, color: "#666" }}>{p.serial || "—"}</td>
                    <td style={TD_STYLE}>{p.stationName || "—"}</td>
                    <td style={TD_STYLE}>{p.operatorName || "—"}</td>
                    <td style={TD_STYLE}>
                      <PileStatusChip onlineStatus={p.onlineStatus} faultCount={p.faultConnectorTotal ?? 0} t={t} />
                    </td>
                    <td style={TD_STYLE}>{p.connectorTotal ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager
            offset={offset}
            pageLimit={PAGE_LIMIT}
            count={rows.length}
            hasMore={hasMore}
            loading={loading}
            onPrev={() => setOffset((o) => Math.max(0, o - PAGE_LIMIT))}
            onNext={() => setOffset((o) => o + PAGE_LIMIT)}
          />
        </>
      )}
    </div>
  );
}
