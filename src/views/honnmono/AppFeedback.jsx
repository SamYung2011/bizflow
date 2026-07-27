import React, { useEffect, useMemo, useRef, useState } from "react";

import { useT } from "../../i18n.jsx";
import {
  callHonnmonoAdmin,
  formatFeedbackTime,
} from "../../lib/honnmonoAdmin.js";


const PAGE_SIZE = 20;

const buttonStyle = {
  border: "1px solid #d7dce5",
  background: "#fff",
  borderRadius: 7,
  padding: "7px 12px",
  fontSize: 13,
  cursor: "pointer",
};

const controlStyle = {
  border: "1px solid #d7dce5",
  background: "#fff",
  borderRadius: 7,
  padding: "7px 10px",
  fontSize: 13,
  minHeight: 34,
};

const cellStyle = {
  borderBottom: "1px solid #eef0f4",
  padding: "10px 12px",
  verticalAlign: "top",
  textAlign: "left",
};


function LogBadge({ status, t }) {
  const config = {
    available: {
      label: t("可下載"),
      background: "#e8f7ee",
      color: "#177245",
      border: "#b9e4ca",
    },
    external: {
      label: t("原廠日誌（外部存儲）"),
      background: "#fff4e5",
      color: "#a54b00",
      border: "#f2c27d",
    },
    expired: {
      label: t("日誌已失效"),
      background: "#f2f4f7",
      color: "#667085",
      border: "#dfe3e8",
    },
  }[status] || {
    label: t("未知"),
    background: "#f2f4f7",
    color: "#667085",
    border: "#dfe3e8",
  };
  return (
    <span
      style={{
        display: "inline-flex",
        padding: "3px 8px",
        borderRadius: 999,
        fontSize: 12,
        whiteSpace: "nowrap",
        background: config.background,
        color: config.color,
        border: `1px solid ${config.border}`,
      }}
    >
      {config.label}
    </span>
  );
}


function DetailRow({ label, value, monospace = false }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "130px minmax(0, 1fr)",
        gap: 12,
        padding: "8px 0",
        borderBottom: "1px solid #f0f1f4",
        fontSize: 13,
      }}
    >
      <div style={{ color: "#687083" }}>{label}</div>
      <div
        style={{
          minWidth: 0,
          overflowWrap: "anywhere",
          fontFamily: monospace ? "ui-monospace, SFMono-Regular, Menlo, monospace" : "inherit",
        }}
      >
        {value == null || value === "" ? "—" : String(value)}
      </div>
    </div>
  );
}


function DetailSection({ title, children }) {
  return (
    <section style={{ marginTop: 22 }}>
      <h4 style={{ margin: "0 0 6px", fontSize: 14, color: "#242938" }}>{title}</h4>
      {children}
    </section>
  );
}


function FeedbackDrawer({
  feedbackId,
  accessToken,
  onClose,
  onDownload,
  downloading,
  t,
  lang,
}) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setDetail(null);
    setLoading(true);
    setError("");
    callHonnmonoAdmin(`/feedback/${feedbackId}`, { accessToken })
      .then((value) => {
        if (active) setDetail(value);
      })
      .catch((reason) => {
        if (active) setError(String(reason?.message || reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [feedbackId, accessToken]);

  return (
    <div
      role="presentation"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1400,
        background: "rgba(18, 24, 38, 0.38)",
        display: "flex",
        justifyContent: "flex-end",
      }}
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={t("反饋詳情")}
        onClick={(event) => event.stopPropagation()}
        style={{
          width: "min(580px, 94vw)",
          height: "100%",
          background: "#fff",
          boxShadow: "-12px 0 36px rgba(15, 23, 42, 0.18)",
          overflowY: "auto",
        }}
      >
        <div
          style={{
            position: "sticky",
            top: 0,
            zIndex: 1,
            background: "#fff",
            borderBottom: "1px solid #e7eaf0",
            padding: "18px 22px",
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: 17 }}>{t("反饋詳情")} #{feedbackId}</h3>
            <div style={{ marginTop: 3, color: "#7a8292", fontSize: 12 }}>
              {t("Honnmono APP 用戶提交內容")}
            </div>
          </div>
          <button type="button" onClick={onClose} style={{ ...buttonStyle, marginLeft: "auto" }}>
            {t("關閉")}
          </button>
        </div>

        <div style={{ padding: "4px 22px 28px" }}>
          {loading && (
            <div style={{ padding: "36px 0", textAlign: "center", color: "#777f8d" }}>
              {t("載入中…")}
            </div>
          )}
          {error && (
            <div
              style={{
                marginTop: 18,
                padding: "10px 12px",
                border: "1px solid #fecaca",
                background: "#fff1f2",
                color: "#b42318",
                borderRadius: 8,
                fontSize: 13,
              }}
            >
              {t("載入反饋詳情失敗：{message}", { message: error })}
            </div>
          )}

          {detail && (
            <>
              <DetailSection title={t("基本資訊")}>
                <DetailRow label={t("建立時間")} value={formatFeedbackTime(detail.createTime, lang)} />
                <DetailRow label={t("狀態")} value={t("狀態值 {value}", { value: detail.status ?? "—" })} />
                <DetailRow label={t("用戶名稱")} value={detail.username} />
                <DetailRow label={t("聯絡方式")} value={detail.contact} />
                <DetailRow label={t("聯絡類型")} value={detail.contactType} />
                <DetailRow label={t("客戶端型號")} value={detail.clientModel} />
                <DetailRow label={t("App 版本")} value={detail.appVersion} />
                <DetailRow label={t("App 型號")} value={detail.appModel} />
                <DetailRow label={t("國家／地區")} value={detail.country} />
              </DetailSection>

              <DetailSection title={t("反饋內容")}>
                <div
                  style={{
                    whiteSpace: "pre-wrap",
                    overflowWrap: "anywhere",
                    border: "1px solid #e5e8ee",
                    background: "#fafbfc",
                    borderRadius: 8,
                    padding: 12,
                    fontSize: 14,
                    lineHeight: 1.65,
                  }}
                >
                  {detail.content || "—"}
                </div>
              </DetailSection>

              <DetailSection title={t("裝置資訊")}>
                <DetailRow label={t("裝置型號")} value={detail.deviceModel} />
                <DetailRow label={t("裝置品牌")} value={detail.deviceBrand} />
                <DetailRow label={t("裝置名稱")} value={detail.deviceName} />
                <DetailRow label={t("系統版本")} value={detail.deviceVersion} />
                <DetailRow label={t("韌體版本")} value={detail.fwversion} />
                <DetailRow label={t("UUID")} value={detail.uuid} monospace />
                <DetailRow label={t("IMEI")} value={detail.imei} monospace />
                <DetailRow label={t("電訊商")} value={detail.deviceSp} />
              </DetailSection>

              <DetailSection title={t("處理資訊")}>
                <DetailRow label={t("回覆")} value={detail.answer} />
                <DetailRow label={t("備註")} value={detail.remark} />
                <DetailRow label={t("FAQ 連結")} value={detail.faqLink} />
                <DetailRow label={t("租戶")} value={detail.tenant} />
                <DetailRow label={t("已派發")} value={detail.isDispatched} />
                <DetailRow label={t("新訊息")} value={detail.hasNewMsg} />
              </DetailSection>

              <DetailSection title={t("日誌")}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <LogBadge status={detail.logStatus} t={t} />
                  {detail.logFilename && (
                    <span style={{ color: "#667085", fontSize: 12, overflowWrap: "anywhere" }}>
                      {detail.logFilename}
                    </span>
                  )}
                  {detail.logStatus === "external" && detail.logExternalUrl ? (
                    <a
                      href={detail.logExternalUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        ...buttonStyle,
                        marginLeft: "auto",
                        color: "#a54b00",
                        borderColor: "#f2c27d",
                        background: "#fffaf2",
                        textDecoration: "none",
                      }}
                    >
                      {t("開啟原廠日誌")}
                    </a>
                  ) : (
                    <button
                      type="button"
                      disabled={detail.logStatus !== "available" || downloading}
                      onClick={() => onDownload(detail)}
                      style={{
                        ...buttonStyle,
                        marginLeft: "auto",
                        color: detail.logStatus === "available" ? "#3158d4" : "#9ca3af",
                        cursor: detail.logStatus === "available" && !downloading ? "pointer" : "not-allowed",
                        background: downloading ? "#f3f4f6" : "#fff",
                      }}
                    >
                      {downloading
                        ? t("準備下載…")
                        : detail.logStatus === "available"
                          ? t("下載日誌")
                          : t("日誌已失效")}
                    </button>
                  )}
                </div>
              </DetailSection>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}


export default function AppFeedback({ session, isAdmin }) {
  const { t, lang } = useT();
  const accessToken = session?.access_token;
  const requestIdRef = useRef(0);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [facets, setFacets] = useState({
    clientModels: [],
    appVersions: [],
    statuses: [],
  });
  const [page, setPage] = useState(1);
  const [clientModel, setClientModel] = useState("");
  const [appVersion, setAppVersion] = useState("");
  const [status, setStatus] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [keyword, setKeyword] = useState("");
  const [refreshTick, setRefreshTick] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [downloadingId, setDownloadingId] = useState(null);
  const [downloadError, setDownloadError] = useState("");

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const queryString = useMemo(() => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(PAGE_SIZE),
    });
    if (clientModel) params.set("clientModel", clientModel);
    if (appVersion) params.set("appVersion", appVersion);
    if (status !== "") params.set("status", status);
    if (keyword) params.set("q", keyword);
    return params.toString();
  }, [page, clientModel, appVersion, status, keyword]);

  useEffect(() => {
    if (!isAdmin || !accessToken) return undefined;
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError("");
    callHonnmonoAdmin(`/feedback?${queryString}`, { accessToken })
      .then((payload) => {
        if (requestId !== requestIdRef.current) return;
        setRows(Array.isArray(payload?.items) ? payload.items : []);
        setTotal(Number(payload?.total) || 0);
        if (payload?.facets) {
          setFacets({
            clientModels: Array.isArray(payload.facets.clientModels)
              ? payload.facets.clientModels
              : [],
            appVersions: Array.isArray(payload.facets.appVersions)
              ? payload.facets.appVersions
              : [],
            statuses: Array.isArray(payload.facets.statuses)
              ? payload.facets.statuses
              : [],
          });
        }
      })
      .catch((reason) => {
        if (requestId === requestIdRef.current) {
          setError(String(reason?.message || reason));
        }
      })
      .finally(() => {
        if (requestId === requestIdRef.current) setLoading(false);
      });
    return () => {
      requestIdRef.current += 1;
    };
  }, [isAdmin, accessToken, queryString, refreshTick]);

  const downloadLog = async (feedback) => {
    if (!accessToken || feedback?.logStatus !== "available") return;
    setDownloadingId(feedback.id);
    setDownloadError("");
    try {
      const payload = await callHonnmonoAdmin(`/feedback/${feedback.id}/log-link`, {
        accessToken,
        method: "POST",
      });
      if (!payload?.downloadUrl) throw new Error(t("下載連結缺失"));
      const link = document.createElement("a");
      link.href = payload.downloadUrl;
      link.rel = "noopener";
      link.download = payload.filename || "";
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (reason) {
      setDownloadError(String(reason?.message || reason));
    } finally {
      setDownloadingId(null);
    }
  };

  if (!isAdmin || !accessToken) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "#777f8d" }}>
        {t("未登入或沒有管理員權限")}
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 16, marginBottom: 18 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 21 }}>{t("用戶反饋")}</h2>
          <p style={{ margin: "6px 0 0", color: "#747c8c", fontSize: 13 }}>
            {t("查看 Honnmono APP 用戶提交的反饋及診斷日誌")}
          </p>
        </div>
        <button
          type="button"
          disabled={loading}
          onClick={() => setRefreshTick((value) => value + 1)}
          style={{
            ...buttonStyle,
            marginLeft: "auto",
            cursor: loading ? "wait" : "pointer",
            background: loading ? "#f3f4f6" : "#fff",
          }}
        >
          {loading ? t("載入中…") : t("重新整理")}
        </button>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
          marginBottom: 14,
        }}
      >
        <select
          aria-label={t("客戶端型號")}
          value={clientModel}
          onChange={(event) => {
            setClientModel(event.target.value);
            setPage(1);
          }}
          style={controlStyle}
        >
          <option value="">{t("全部客戶端")}</option>
          {facets.clientModels.map((value) => (
            <option key={value} value={value}>{value}</option>
          ))}
        </select>
        <select
          aria-label={t("App 版本")}
          value={appVersion}
          onChange={(event) => {
            setAppVersion(event.target.value);
            setPage(1);
          }}
          style={controlStyle}
        >
          <option value="">{t("全部版本")}</option>
          {facets.appVersions.map((value) => (
            <option key={value} value={value}>{value}</option>
          ))}
        </select>
        <select
          aria-label={t("狀態")}
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setPage(1);
          }}
          style={controlStyle}
        >
          <option value="">{t("全部狀態")}</option>
          {facets.statuses.map((value) => (
            <option key={value} value={value}>
              {t("狀態值 {value}", { value })}
            </option>
          ))}
        </select>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setKeyword(searchInput.trim());
            setPage(1);
          }}
          style={{ display: "flex", gap: 7, flex: "1 1 300px" }}
        >
          <input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder={t("搜尋內容或聯絡方式…")}
            aria-label={t("搜尋內容或聯絡方式")}
            style={{ ...controlStyle, flex: 1, minWidth: 180 }}
          />
          <button
            type="submit"
            style={{
              ...buttonStyle,
              borderColor: "#486ee8",
              background: "#486ee8",
              color: "#fff",
            }}
          >
            {t("搜尋")}
          </button>
        </form>
        <span style={{ color: "#737b8b", fontSize: 12 }}>
          {t("共 {count} 筆", { count: total })}
        </span>
      </div>

      {(error || downloadError) && (
        <div
          style={{
            marginBottom: 12,
            padding: "10px 12px",
            border: "1px solid #fecaca",
            background: "#fff1f2",
            color: "#b42318",
            borderRadius: 8,
            fontSize: 13,
          }}
        >
          {error
            ? t("載入反饋失敗：{message}", { message: error })
            : t("建立下載連結失敗：{message}", { message: downloadError })}
        </div>
      )}

      <div style={{ overflowX: "auto", border: "1px solid #e3e6ec", borderRadius: 9 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "#f8f9fb", color: "#5f6878" }}>
              {[
                t("建立時間"),
                t("客戶端型號"),
                t("App 版本"),
                t("聯絡方式"),
                t("反饋內容"),
                t("狀態"),
                t("日誌"),
                t("操作"),
              ].map((label) => (
                <th key={label} style={{ ...cellStyle, whiteSpace: "nowrap", fontWeight: 650 }}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td style={{ ...cellStyle, whiteSpace: "nowrap", color: "#626b7a" }}>
                  {formatFeedbackTime(row.createTime, lang)}
                </td>
                <td style={cellStyle}>{row.clientModel || "—"}</td>
                <td style={{ ...cellStyle, whiteSpace: "nowrap" }}>{row.appVersion || "—"}</td>
                <td style={{ ...cellStyle, maxWidth: 190, overflowWrap: "anywhere" }}>
                  {row.contact || "—"}
                </td>
                <td style={{ ...cellStyle, minWidth: 240, maxWidth: 420 }}>
                  <div
                    title={row.content || ""}
                    style={{
                      display: "-webkit-box",
                      WebkitBoxOrient: "vertical",
                      WebkitLineClamp: 2,
                      overflow: "hidden",
                      lineHeight: 1.45,
                    }}
                  >
                    {row.content || "—"}
                  </div>
                </td>
                <td style={{ ...cellStyle, whiteSpace: "nowrap" }}>
                  {t("狀態值 {value}", { value: row.status ?? "—" })}
                </td>
                <td style={cellStyle}>
                  {row.logStatus === "external" && row.logExternalUrl ? (
                    <a
                      href={row.logExternalUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={t("開啟原廠日誌")}
                      style={{ display: "inline-flex", textDecoration: "none" }}
                    >
                      <LogBadge status={row.logStatus} t={t} />
                    </a>
                  ) : (
                    <LogBadge status={row.logStatus} t={t} />
                  )}
                </td>
                <td style={cellStyle}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedId(row.id);
                      setDownloadError("");
                    }}
                    style={{ ...buttonStyle, padding: "5px 10px", color: "#3158d4" }}
                  >
                    {t("詳情")}
                  </button>
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={8} style={{ padding: 42, textAlign: "center", color: "#7a8292" }}>
                  {t("沒有反饋記錄")}
                </td>
              </tr>
            )}
            {loading && rows.length === 0 && (
              <tr>
                <td colSpan={8} style={{ padding: 42, textAlign: "center", color: "#7a8292" }}>
                  {t("載入中…")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          alignItems: "center",
          gap: 9,
          marginTop: 13,
        }}
      >
        <span style={{ fontSize: 12, color: "#737b8b" }}>
          {t("第 {page} / {pages} 頁", { page, pages: pageCount })}
        </span>
        <button
          type="button"
          disabled={page <= 1 || loading}
          onClick={() => setPage((value) => Math.max(1, value - 1))}
          style={{
            ...buttonStyle,
            opacity: page <= 1 || loading ? 0.45 : 1,
            cursor: page <= 1 || loading ? "not-allowed" : "pointer",
          }}
        >
          {t("上一頁")}
        </button>
        <button
          type="button"
          disabled={page >= pageCount || loading}
          onClick={() => setPage((value) => Math.min(pageCount, value + 1))}
          style={{
            ...buttonStyle,
            opacity: page >= pageCount || loading ? 0.45 : 1,
            cursor: page >= pageCount || loading ? "not-allowed" : "pointer",
          }}
        >
          {t("下一頁")}
        </button>
      </div>

      {selectedId != null && (
        <FeedbackDrawer
          feedbackId={selectedId}
          accessToken={accessToken}
          onClose={() => setSelectedId(null)}
          onDownload={downloadLog}
          downloading={downloadingId === selectedId}
          t={t}
          lang={lang}
        />
      )}
    </div>
  );
}
