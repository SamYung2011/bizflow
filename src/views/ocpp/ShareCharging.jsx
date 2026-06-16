import React, { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "../../i18n.jsx";
import { callOcppAdmin, fmtUnixTs } from "../../lib/ocppAdmin.js";
import {
  Chip,
  DetailGrid,
  DetailRow,
  DetailToggleButton,
  EmptyState,
  ErrorBanner,
  FilterBar,
  flowTone,
  MoneyText,
  Pager,
  SearchBox,
  Select,
  TableHead,
  TABLE_STYLE,
  TABLE_WRAP_STYLE,
  TD_STYLE,
  MONO_TD_STYLE,
} from "./finance/financeShared.jsx";

// 共享充電 — chargecms private-pile sharing configuration + owner income logs（list 唯讀）
// 零寫入 / 不發 OCPP 命令 / 不動 vendor 8081 / 不動 chargecms PHP。

const PAGE_LIMIT = 50;

const INNER_TABS = [
  { id: "charges", labelKey: "共享充電桩" },
  { id: "income", labelKey: "共享分潤" },
  { id: "bookings", labelKey: "共享預約" },
];

const SHARE_OPTIONS = [
  ["all", "全部共享狀態"],
  ["enabled", "已開放共享"],
  ["disabled", "未開放共享"],
];

const INCOME_TYPE_OPTIONS = [
  ["all", "全部類型"],
  ["1", "收益"],
  ["2", "提現"],
  ["3", "轉入餘額"],
];

function fmtClockSeconds(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return "—";
  const hours = Math.floor(n / 3600);
  const minutes = Math.floor((n % 3600) / 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function openWindow(row) {
  return `${fmtClockSeconds(row.openStartTime)} - ${fmtClockSeconds(row.openEndTime)}`;
}

function bookingWindow(row) {
  const start = Number(row.startTime ?? row.start_time);
  const end = Number(row.endTime ?? row.end_time);
  if (start === 0 && end === 86400) return "全天";
  return `${fmtClockSeconds(start)} - ${fmtClockSeconds(end)}`;
}

function ownerName(row) {
  return row.ownerNickname || row.ownerUsername || row.ownerEmail || row.ownerUserId || "—";
}

function bookingUserName(row) {
  return row.nickname || row.username || row.email || row.userId || row.user_id || "—";
}

function pileName(row) {
  return row.pileName || row.pileNo || (row.pileId ? `#${row.pileId}` : "—");
}

function bookingPileName(row) {
  return row.pileName || row.pileNo || row.pile_no || (row.pileId ? `#${row.pileId}` : "—");
}

function bookingTypeName(row) {
  return row.bookingTypeName || row.typeName || row.booking_type_name || row.bookingType || row.booking_type || "—";
}

function bookingTypeLabel(row) {
  const value = String(bookingTypeName(row));
  const key = value.trim().toLowerCase();
  if (key === "single" || value === "1") return "單次";
  if (key === "mon-fri" || key === "mon-fri." || value === "2") return "週一至週五";
  if (key === "every day" || key === "everyday" || value === "3") return "每日";
  if (key === "weekend" || value === "4") return "週末";
  return value;
}

function bookingDate(row) {
  const v = row.date ?? row.bookingDate ?? row.booking_date;
  if (!v || v === "0000-00-00") return "—";
  return String(v);
}

function bookingStateLabel(row) {
  const value = row.state ?? row.bookingState ?? row.booking_state;
  return value === undefined || value === null || value === "" ? "—" : String(value);
}

function shareTone(row) {
  if (row.shareEnabled) return "green";
  return "gray";
}

function onlineTone(onlineStatus) {
  return Number(onlineStatus) === 1 ? "green" : "gray";
}

function incomeTypeKey(typeKey) {
  if (typeKey === "income") return "收益";
  if (typeKey === "withdrawal") return "提現";
  if (typeKey === "enter_balance") return "轉入餘額";
  return "未知";
}

function incomeTone(typeKey, money) {
  const n = Number(money);
  if (Number.isFinite(n) && n < 0) return "out";
  if (typeKey === "income" || typeKey === "enter_balance") return "in";
  if (typeKey === "withdrawal") return "out";
  return flowTone(typeKey, money);
}

function InnerTabs({ value, onChange }) {
  const { t } = useT();
  return (
    <div style={{ display: "flex", gap: 4, marginBottom: 14 }}>
      {INNER_TABS.map((tab) => {
        const active = value === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            style={{
              padding: "6px 14px",
              borderRadius: 6,
              border: active ? "1px solid #1976d2" : "1px solid #ddd",
              background: active ? "#e3f2fd" : "#fff",
              color: active ? "#1976d2" : "#555",
              fontSize: 13,
              fontWeight: active ? 600 : 500,
              cursor: "pointer",
            }}
          >
            {t(tab.labelKey)}
          </button>
        );
      })}
    </div>
  );
}

function ShareChargesTab({ session, isAdmin, active }) {
  const { t } = useT();
  const [rows, setRows] = useState([]);
  const [priceRowsByShareId, setPriceRowsByShareId] = useState({});
  const [loadingPriceByShareId, setLoadingPriceByShareId] = useState({});
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [shareFilter, setShareFilter] = useState("all");
  const [searchInput, setSearchInput] = useState("");
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const aliveRef = useRef(true);
  const wasActiveRef = useRef(active);
  const accessToken = session?.access_token;

  const refresh = useCallback(async ({ force = false } = {}) => {
    if (!isAdmin || !accessToken) return;
    setLoading(true);
    setErr("");
    try {
      const qs = new URLSearchParams();
      qs.set("limit", String(PAGE_LIMIT));
      qs.set("offset", String(offset));
      if (shareFilter) qs.set("share", shareFilter);
      if (q) qs.set("q", q);
      const data = await callOcppAdmin(`/share/charges?${qs}`, { accessToken, force });
      if (!aliveRef.current) return;
      setRows(Array.isArray(data?.data) ? data.data : []);
      setHasMore(Boolean(data?.page?.hasMore));
    } catch (e) {
      if (!aliveRef.current) return;
      setErr(String(e?.message || e));
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, [isAdmin, accessToken, shareFilter, q, offset]);

  const loadPrices = useCallback(async (shareId) => {
    if (!isAdmin || !accessToken || !shareId || priceRowsByShareId[shareId] || loadingPriceByShareId[shareId]) return;
    setLoadingPriceByShareId((prev) => ({ ...prev, [shareId]: true }));
    try {
      const data = await callOcppAdmin(`/share/prices/${shareId}?limit=200`, { accessToken });
      if (!aliveRef.current) return;
      setPriceRowsByShareId((prev) => ({ ...prev, [shareId]: Array.isArray(data?.data) ? data.data : [] }));
    } catch {
      if (!aliveRef.current) return;
      setPriceRowsByShareId((prev) => ({ ...prev, [shareId]: [] }));
    } finally {
      if (aliveRef.current) setLoadingPriceByShareId((prev) => ({ ...prev, [shareId]: false }));
    }
  }, [isAdmin, accessToken, priceRowsByShareId, loadingPriceByShareId]);

  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (active && !wasActiveRef.current) refresh();
    wasActiveRef.current = active;
  }, [active, refresh]);

  const empty = !loading && !err && rows.length === 0;

  return (
    <>
      <FilterBar title={t("共享充電桩")} onRefresh={refresh} loading={loading} count={rows.length}>
        <Select value={shareFilter} onChange={(v) => { setOffset(0); setShareFilter(v); }} options={SHARE_OPTIONS} />
        <SearchBox
          value={searchInput}
          onChange={setSearchInput}
          onSubmit={() => { setOffset(0); setQ(searchInput.trim()); }}
          placeholder={t("桩號 / 地址 / owner")}
          width={240}
        />
      </FilterBar>
      <ErrorBanner message={err} />
      {empty && <EmptyState message={t("無共享充電數據")} />}
      {rows.length > 0 && (
        <>
          <div style={TABLE_WRAP_STYLE}>
            <table style={TABLE_STYLE}>
              <TableHead columns={[
                t("桩號"),
                t("Owner"),
                { label: t("價格"), align: "right" },
                { label: t("佔用費"), align: "right" },
                t("開放時段"),
                t("狀態"),
                t("地址"),
                t("操作"),
              ]} />
              <tbody>
                {rows.map((row) => {
                  const rowKey = row.shareId || row.pileId;
                  const open = expanded === rowKey;
                  const priceRows = priceRowsByShareId[row.shareId] || [];
                  return (
                    <React.Fragment key={rowKey}>
                      <tr style={{ borderBottom: open ? "none" : "1px solid #f3f4f6" }}>
                        <td style={TD_STYLE}>
                          <div style={{ fontWeight: 600 }}>{pileName(row)}</div>
                          <div style={{ fontSize: 12, color: "#888" }}>{row.pileNo || `#${row.pileId}`}</div>
                        </td>
                        <td style={TD_STYLE}>
                          <div>{ownerName(row)}</div>
                          <div style={{ fontSize: 12, color: "#888" }}>{row.ownerEmail || row.ownerUserId || "—"}</div>
                        </td>
                        <td style={{ ...TD_STYLE, textAlign: "right" }}><MoneyText value={row.price} /></td>
                        <td style={{ ...TD_STYLE, textAlign: "right" }}><MoneyText value={row.spaceOccupancyFee} /></td>
                        <td style={MONO_TD_STYLE}>{openWindow(row)}</td>
                        <td style={TD_STYLE}>
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            <Chip label={row.shareEnabled ? t("已開放共享") : t("未開放共享")} tone={shareTone(row)} />
                            <Chip label={Number(row.onlineStatus) === 1 ? t("在線") : t("離線")} tone={onlineTone(row.onlineStatus)} />
                          </div>
                        </td>
                        <td style={{ ...TD_STYLE, minWidth: 220 }}>{row.address || row.stationName || "—"}</td>
                        <td style={TD_STYLE}>
                          <DetailToggleButton
                            open={open}
                            onClick={() => {
                              setExpanded(open ? null : rowKey);
                              if (!open && row.shareId) loadPrices(row.shareId);
                            }}
                          />
                        </td>
                      </tr>
                      {open && (
                        <tr style={{ borderBottom: "1px solid #f3f4f6", background: "#fcfcfd" }}>
                          <td colSpan={8} style={{ padding: "12px 16px" }}>
                            <DetailGrid>
                              <DetailRow label={t("共享ID")}>{row.shareId || "—"}</DetailRow>
                              <DetailRow label={t("站點")}>{row.stationName || (Number(row.stationId) === 0 ? t("未分配站點") : "—")}</DetailRow>
                              <DetailRow label={t("運營商")}>{row.operatorName || "—"}</DetailRow>
                              <DetailRow label={t("槍數")}>{row.connectorTotal ?? 0}</DetailRow>
                              <DetailRow label={t("不刷卡")}>{row.notCard ? t("是") : t("否")}</DetailRow>
                              <DetailRow label={t("標籤")}>{row.tags?.length ? row.tags.join(", ") : "—"}</DetailRow>
                              <DetailRow label={t("經緯度")}>{row.longitude && row.latitude ? `${row.longitude}, ${row.latitude}` : "—"}</DetailRow>
                              <DetailRow label={t("更新時間")}>{fmtUnixTs(row.shareUpdatedAt || row.pileUpdatedAt)}</DetailRow>
                            </DetailGrid>
                            <div style={{ marginTop: 12, fontSize: 13, fontWeight: 600 }}>{t("價格時段")}</div>
                            {loadingPriceByShareId[row.shareId] ? (
                              <div style={{ color: "#888", fontSize: 13, paddingTop: 6 }}>{t("載入中…")}</div>
                            ) : priceRows.length ? (
                              <div style={{ marginTop: 6, display: "grid", gap: 4 }}>
                                {priceRows.map((price) => (
                                  <div key={price.priceId} style={{ fontSize: 13, color: "#444" }}>
                                    <span style={{ fontFamily: "monospace" }}>{fmtClockSeconds(price.startTime)} - {fmtClockSeconds(price.endTime)}</span>
                                    <span style={{ marginLeft: 12 }}><MoneyText value={price.price} /></span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div style={{ color: "#888", fontSize: 13, paddingTop: 6 }}>{t("無價格時段")}</div>
                            )}
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
    </>
  );
}

function ShareIncomeTab({ session, isAdmin, active }) {
  const { t } = useT();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [type, setType] = useState("all");
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
      qs.set("limit", String(PAGE_LIMIT));
      qs.set("offset", String(offset));
      if (type) qs.set("type", type);
      if (q) qs.set("q", q);
      const data = await callOcppAdmin(`/share/income?${qs}`, { accessToken, force });
      if (!aliveRef.current) return;
      setRows(Array.isArray(data?.data) ? data.data : []);
      setHasMore(Boolean(data?.page?.hasMore));
    } catch (e) {
      if (!aliveRef.current) return;
      setErr(String(e?.message || e));
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, [isAdmin, accessToken, type, q, offset]);

  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (active && !wasActiveRef.current) refresh();
    wasActiveRef.current = active;
  }, [active, refresh]);

  const empty = !loading && !err && rows.length === 0;

  return (
    <>
      <FilterBar title={t("共享分潤")} onRefresh={refresh} loading={loading} count={rows.length}>
        <Select value={type} onChange={(v) => { setOffset(0); setType(v); }} options={INCOME_TYPE_OPTIONS} />
        <SearchBox
          value={searchInput}
          onChange={setSearchInput}
          onSubmit={() => { setOffset(0); setQ(searchInput.trim()); }}
          placeholder={t("用戶 / 訂單 / 備註")}
          width={240}
        />
      </FilterBar>
      <ErrorBanner message={err} />
      {empty && <EmptyState message={t("無共享分潤數據")} />}
      {rows.length > 0 && (
        <>
          <div style={TABLE_WRAP_STYLE}>
            <table style={TABLE_STYLE}>
              <TableHead columns={[
                t("時間"),
                t("類型"),
                t("Owner"),
                { label: t("金額"), align: "right" },
                { label: t("變動後餘額"), align: "right" },
                t("訂單ID"),
                t("備註"),
              ]} />
              <tbody>
                {rows.map((row) => (
                  <tr key={row.logId} style={{ borderBottom: "1px solid #f3f4f6" }}>
                    <td style={MONO_TD_STYLE}>{fmtUnixTs(row.createdAt)}</td>
                    <td style={TD_STYLE}><Chip label={t(incomeTypeKey(row.typeKey))} tone={row.typeKey === "withdrawal" ? "orange" : "green"} /></td>
                    <td style={TD_STYLE}>
                      <div>{row.nickname || row.username || row.email || row.userId || "—"}</div>
                      <div style={{ fontSize: 12, color: "#888" }}>{row.email || row.userId || "—"}</div>
                    </td>
                    <td style={{ ...TD_STYLE, textAlign: "right" }}><MoneyText value={row.money} tone={incomeTone(row.typeKey, row.money)} /></td>
                    <td style={{ ...TD_STYLE, textAlign: "right" }}><MoneyText value={row.afterMoney} /></td>
                    <td style={MONO_TD_STYLE}>{row.orderId || "—"}</td>
                    <td style={{ ...TD_STYLE, minWidth: 220 }}>{row.memo || "—"}</td>
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
    </>
  );
}

function ShareBookingsTab({ session, isAdmin, active }) {
  const { t } = useT();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
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
      qs.set("limit", String(PAGE_LIMIT));
      qs.set("offset", String(offset));
      if (q) qs.set("q", q);
      const data = await callOcppAdmin(`/share/bookings?${qs}`, { accessToken, force });
      if (!aliveRef.current) return;
      setRows(Array.isArray(data?.data) ? data.data : []);
      setHasMore(Boolean(data?.page?.hasMore));
    } catch (e) {
      if (!aliveRef.current) return;
      setErr(String(e?.message || e));
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, [isAdmin, accessToken, q, offset]);

  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (active && !wasActiveRef.current) refresh();
    wasActiveRef.current = active;
  }, [active, refresh]);

  const empty = !loading && !err && rows.length === 0;

  return (
    <>
      <FilterBar title={t("共享預約")} onRefresh={refresh} loading={loading} count={rows.length}>
        <SearchBox
          value={searchInput}
          onChange={setSearchInput}
          onSubmit={() => { setOffset(0); setQ(searchInput.trim()); }}
          placeholder={t("用戶 / 桩號")}
          width={240}
        />
      </FilterBar>
      <ErrorBanner message={err} />
      {empty && <EmptyState message={t("無共享預約數據")} />}
      {rows.length > 0 && (
        <>
          <div style={TABLE_WRAP_STYLE}>
            <table style={TABLE_STYLE}>
              <TableHead columns={[
                t("用戶"),
                t("桩號"),
                t("預約日期"),
                t("起止時段"),
                t("預約類型"),
                t("狀態"),
                t("建立時間"),
              ]} />
              <tbody>
                {rows.map((row) => {
                  const rowKey = row.bookingId || row.id || `${row.shareId || ""}-${row.userId || ""}-${row.pileNo || ""}`;
                  return (
                    <tr key={rowKey} style={{ borderBottom: "1px solid #f3f4f6" }}>
                      <td style={TD_STYLE}>
                        <div>{bookingUserName(row)}</div>
                        <div style={{ fontSize: 12, color: "#888" }}>{row.email || row.userId || row.user_id || "—"}</div>
                      </td>
                      <td style={TD_STYLE}>
                        <div style={{ fontWeight: 600 }}>{bookingPileName(row)}</div>
                        <div style={{ fontSize: 12, color: "#888" }}>{row.stationName || row.ownerNickname || row.ownerUserId || "—"}</div>
                      </td>
                      <td style={MONO_TD_STYLE}>{bookingDate(row)}</td>
                      <td style={MONO_TD_STYLE}>{t(bookingWindow(row))}</td>
                      <td style={TD_STYLE}>{t(bookingTypeLabel(row))}</td>
                      <td style={TD_STYLE}>
                        <span title={t("語義待確認")}>
                          <Chip label={bookingStateLabel(row)} tone="gray" />
                        </span>
                      </td>
                      <td style={MONO_TD_STYLE}>{fmtUnixTs(row.createdAt || row.createTime || row.create_time)}</td>
                    </tr>
                  );
                })}
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
    </>
  );
}

export default function ShareCharging({ session, isAdmin, active = true }) {
  const { t } = useT();
  const [tab, setTab] = useState("charges");
  const [visitedTabs, setVisitedTabs] = useState(() => new Set(["charges"]));

  useEffect(() => {
    setVisitedTabs((prev) => {
      if (prev.has(tab)) return prev;
      const next = new Set(prev);
      next.add(tab);
      return next;
    });
  }, [tab]);

  if (!isAdmin) {
    return <div style={{ padding: 40, textAlign: "center", color: "#999" }}>{t("無權訪問")}</div>;
  }

  return (
    <div>
      <InnerTabs value={tab} onChange={setTab} />
      {visitedTabs.has("charges") && (
        <div style={{ display: tab === "charges" ? "block" : "none" }}>
          <ShareChargesTab session={session} isAdmin={isAdmin} active={active && tab === "charges"} />
        </div>
      )}
      {visitedTabs.has("income") && (
        <div style={{ display: tab === "income" ? "block" : "none" }}>
          <ShareIncomeTab session={session} isAdmin={isAdmin} active={active && tab === "income"} />
        </div>
      )}
      {visitedTabs.has("bookings") && (
        <div style={{ display: tab === "bookings" ? "block" : "none" }}>
          <ShareBookingsTab session={session} isAdmin={isAdmin} active={active && tab === "bookings"} />
        </div>
      )}
    </div>
  );
}
