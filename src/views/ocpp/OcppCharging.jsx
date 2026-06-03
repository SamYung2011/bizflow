import React, { useEffect, useState, lazy, Suspense } from "react";
import { useT } from "../../i18n.jsx";

// OCPP 充電站 hub — 8 sub-tab 容器
// 每個 sub-tab 獨立文件，按需 lazy load 防止 hub 一加載就把全部子組件拉滿
const PublicPiles = lazy(() => import("./PublicPiles.jsx"));
const PrivatePiles = lazy(() => import("./PrivatePiles.jsx"));
const Stations = lazy(() => import("./Stations.jsx"));
const ShareCharging = lazy(() => import("./ShareCharging.jsx"));
const AlarmInfo = lazy(() => import("./AlarmInfo.jsx"));
const OcppOrders = lazy(() => import("./OcppOrders.jsx"));
const CommandLogs = lazy(() => import("./CommandLogs.jsx"));
const Operators = lazy(() => import("./Operators.jsx"));

const SUB_TABS = [
  { id: "publicPiles", labelKey: "公共充電桩" },
  { id: "privatePiles", labelKey: "私人充電桩" },
  { id: "stations", labelKey: "充電站" },
  { id: "shareCharging", labelKey: "共享充電" },
  { id: "orders", labelKey: "充電訂單" },
  { id: "commandLogs", labelKey: "命令日誌" },
  { id: "alarms", labelKey: "報警信息" },
  { id: "operators", labelKey: "運營商" },
];

export default function OcppCharging(props) {
  const { t } = useT();
  const { isAdmin } = props;
  const [subTab, setSubTab] = useState("publicPiles");
  const [visitedTabs, setVisitedTabs] = useState(() => new Set(["publicPiles"]));

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
        {visitedTabs.has("publicPiles") && <div style={{ display: subTab === "publicPiles" ? "block" : "none" }}><PublicPiles {...props} active={subTab === "publicPiles"} /></div>}
        {visitedTabs.has("privatePiles") && <div style={{ display: subTab === "privatePiles" ? "block" : "none" }}><PrivatePiles {...props} active={subTab === "privatePiles"} /></div>}
        {visitedTabs.has("stations") && <div style={{ display: subTab === "stations" ? "block" : "none" }}><Stations {...props} active={subTab === "stations"} /></div>}
        {visitedTabs.has("shareCharging") && <div style={{ display: subTab === "shareCharging" ? "block" : "none" }}><ShareCharging {...props} active={subTab === "shareCharging"} /></div>}
        {visitedTabs.has("orders") && <div style={{ display: subTab === "orders" ? "block" : "none" }}><OcppOrders {...props} active={subTab === "orders"} /></div>}
        {visitedTabs.has("commandLogs") && <div style={{ display: subTab === "commandLogs" ? "block" : "none" }}><CommandLogs {...props} active={subTab === "commandLogs"} /></div>}
        {visitedTabs.has("alarms") && <div style={{ display: subTab === "alarms" ? "block" : "none" }}><AlarmInfo {...props} active={subTab === "alarms"} /></div>}
        {visitedTabs.has("operators") && <div style={{ display: subTab === "operators" ? "block" : "none" }}><Operators {...props} active={subTab === "operators"} /></div>}
      </Suspense>
    </div>
  );
}
