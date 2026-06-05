import React, { useEffect, useState, lazy, Suspense } from "react";
import { useT } from "../../../i18n.jsx";

// OCPP 財務 hub — 6 sub-tab 容器（充值訂單 / 退款 / 用戶錢包 / 運營商 / 平台 / 提現）
// 每個 sub-tab 獨立文件，按需 lazy load 防止 hub 一加載就把全部子組件拉滿
// 已訪問 tab 用 display:none 保活，切回不重卸載；active prop 邊沿檢測在隱藏→顯示時 refresh
const Recharges = lazy(() => import("./Recharges.jsx"));
const Refunds = lazy(() => import("./Refunds.jsx"));
const UserMoneyLogs = lazy(() => import("./UserMoneyLogs.jsx"));
const OperatorMoneyLogs = lazy(() => import("./OperatorMoneyLogs.jsx"));
const PlatformMoneyLogs = lazy(() => import("./PlatformMoneyLogs.jsx"));
const Withdrawals = lazy(() => import("./Withdrawals.jsx"));

const SUB_TABS = [
  { id: "recharges", labelKey: "充值訂單" },
  { id: "refunds", labelKey: "退款" },
  { id: "userMoneyLogs", labelKey: "用戶錢包" },
  { id: "operatorMoneyLogs", labelKey: "運營商流水" },
  { id: "platformMoneyLogs", labelKey: "平台流水" },
  { id: "withdrawals", labelKey: "提現" },
];

export default function OcppFinance(props) {
  const { t } = useT();
  const { isAdmin } = props;
  const [subTab, setSubTab] = useState("recharges");
  const [visitedTabs, setVisitedTabs] = useState(() => new Set(["recharges"]));

  useEffect(() => {
    setVisitedTabs((prev) => {
      if (prev.has(subTab)) return prev;
      const next = new Set(prev);
      next.add(subTab);
      return next;
    });
  }, [subTab]);

  if (!isAdmin) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "#999" }}>
        {t("無權訪問")}
      </div>
    );
  }

  return (
    <div style={{ padding: "16px 20px", maxWidth: 1400 }}>
      <div style={{ display: "flex", gap: 4, marginBottom: 16, borderBottom: "1px solid #e5e7eb" }}>
        {SUB_TABS.map((tab) => {
          const active = subTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setSubTab(tab.id)}
              style={{
                padding: "8px 16px",
                background: "none",
                border: "none",
                borderBottom: active ? "2px solid #1976d2" : "2px solid transparent",
                color: active ? "#1976d2" : "#666",
                fontSize: 14,
                fontWeight: active ? 600 : 500,
                cursor: "pointer",
                marginBottom: -1,
              }}
            >
              {t(tab.labelKey)}
            </button>
          );
        })}
      </div>

      <Suspense fallback={<div style={{ padding: 40, textAlign: "center", color: "#888" }}>{t("載入中…")}</div>}>
        {visitedTabs.has("recharges") && <div style={{ display: subTab === "recharges" ? "block" : "none" }}><Recharges {...props} active={subTab === "recharges"} /></div>}
        {visitedTabs.has("refunds") && <div style={{ display: subTab === "refunds" ? "block" : "none" }}><Refunds {...props} active={subTab === "refunds"} /></div>}
        {visitedTabs.has("userMoneyLogs") && <div style={{ display: subTab === "userMoneyLogs" ? "block" : "none" }}><UserMoneyLogs {...props} active={subTab === "userMoneyLogs"} /></div>}
        {visitedTabs.has("operatorMoneyLogs") && <div style={{ display: subTab === "operatorMoneyLogs" ? "block" : "none" }}><OperatorMoneyLogs {...props} active={subTab === "operatorMoneyLogs"} /></div>}
        {visitedTabs.has("platformMoneyLogs") && <div style={{ display: subTab === "platformMoneyLogs" ? "block" : "none" }}><PlatformMoneyLogs {...props} active={subTab === "platformMoneyLogs"} /></div>}
        {visitedTabs.has("withdrawals") && <div style={{ display: subTab === "withdrawals" ? "block" : "none" }}><Withdrawals {...props} active={subTab === "withdrawals"} /></div>}
      </Suspense>
    </div>
  );
}
