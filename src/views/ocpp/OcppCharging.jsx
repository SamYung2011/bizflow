import React, { useState, lazy, Suspense } from "react";
import { useT } from "../../i18n.jsx";

// OCPP 充電站 hub — 6 sub-tab 容器
// 每個 sub-tab 獨立文件，按需 lazy load 防止 hub 一加載就把全部子組件拉滿
const PublicPiles = lazy(() => import("./PublicPiles.jsx"));
const PrivatePiles = lazy(() => import("./PrivatePiles.jsx"));
const Stations = lazy(() => import("./Stations.jsx"));
const AlarmInfo = lazy(() => import("./AlarmInfo.jsx"));
const OcppOrders = lazy(() => import("./OcppOrders.jsx"));
const CommandLogs = lazy(() => import("./CommandLogs.jsx"));

const SUB_TABS = [
  { id: "publicPiles", labelKey: "公共充電桩" },
  { id: "privatePiles", labelKey: "私人充電桩" },
  { id: "stations", labelKey: "充電站" },
  { id: "orders", labelKey: "充電訂單" },
  { id: "commandLogs", labelKey: "命令日誌" },
  { id: "alarms", labelKey: "報警信息" },
];

export default function OcppCharging(props) {
  const { t } = useT();
  const { isAdmin } = props;
  const [subTab, setSubTab] = useState("publicPiles");

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
        {subTab === "publicPiles" && <PublicPiles {...props} />}
        {subTab === "privatePiles" && <PrivatePiles {...props} />}
        {subTab === "stations" && <Stations {...props} />}
        {subTab === "orders" && <OcppOrders {...props} />}
        {subTab === "commandLogs" && <CommandLogs {...props} />}
        {subTab === "alarms" && <AlarmInfo {...props} />}
      </Suspense>
    </div>
  );
}
