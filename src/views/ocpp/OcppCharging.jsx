import React, { useEffect, useState, lazy, Suspense } from "react";
import { useT } from "../../i18n.jsx";

// OCPP 充電站 hub — 充電資產 / 共享 / 訂單 / 報表 / 運營商
// 每個 sub-tab 獨立文件，按需 lazy load 防止 hub 一加載就把全部子組件拉滿
const Piles = lazy(() => import("./Piles.jsx"));
const Stations = lazy(() => import("./Stations.jsx"));
const ShareCharging = lazy(() => import("./ShareCharging.jsx"));
const OcppOrders = lazy(() => import("./OcppOrders.jsx"));
const OcppReports = lazy(() => import("./OcppReports.jsx"));
const Operators = lazy(() => import("./Operators.jsx"));

const SUB_TABS = [
  { id: "piles", labelKey: "充電桩" },
  { id: "stations", labelKey: "充電站" },
  { id: "shareCharging", labelKey: "共享充電" },
  { id: "orders", labelKey: "充電訂單" },
  { id: "reports", labelKey: "充電報表" },
  { id: "operators", labelKey: "運營商" },
];

export default function OcppCharging(props) {
  const { t } = useT();
  const { isAdmin } = props;
  const [subTab, setSubTab] = useState("piles");
  const [visitedTabs, setVisitedTabs] = useState(() => new Set(["piles"]));

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
        {visitedTabs.has("piles") && <div style={{ display: subTab === "piles" ? "block" : "none" }}><Piles {...props} active={subTab === "piles"} /></div>}
        {visitedTabs.has("stations") && <div style={{ display: subTab === "stations" ? "block" : "none" }}><Stations {...props} active={subTab === "stations"} /></div>}
        {visitedTabs.has("shareCharging") && <div style={{ display: subTab === "shareCharging" ? "block" : "none" }}><ShareCharging {...props} active={subTab === "shareCharging"} /></div>}
        {visitedTabs.has("orders") && <div style={{ display: subTab === "orders" ? "block" : "none" }}><OcppOrders {...props} active={subTab === "orders"} /></div>}
        {visitedTabs.has("reports") && <div style={{ display: subTab === "reports" ? "block" : "none" }}><OcppReports {...props} active={subTab === "reports"} /></div>}
        {visitedTabs.has("operators") && <div style={{ display: subTab === "operators" ? "block" : "none" }}><Operators {...props} active={subTab === "operators"} /></div>}
      </Suspense>
    </div>
  );
}
