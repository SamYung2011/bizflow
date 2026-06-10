import React, { useEffect, useState, lazy, Suspense } from "react";
import { useT } from "../../i18n.jsx";

// OCPP 用戶 hub — 用戶信息 + RFID 卡。子頁保持獨立文件，避免 OCPP nav 重構後變成大雜燴。
const ChargeUsers = lazy(() => import("./ChargeUsers.jsx"));
const ChargeUserTags = lazy(() => import("./ChargeUserTags.jsx"));

const SUB_TABS = [
  { id: "users", labelKey: "用戶信息" },
  { id: "tags", labelKey: "RFID 卡" },
];

export default function OcppUsers(props) {
  const { t } = useT();
  const { isAdmin } = props;
  const [subTab, setSubTab] = useState("users");
  const [visitedTabs, setVisitedTabs] = useState(() => new Set(["users"]));

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
              type="button"
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
        {visitedTabs.has("users") && (
          <div style={{ display: subTab === "users" ? "block" : "none" }}>
            <ChargeUsers {...props} active={subTab === "users"} />
          </div>
        )}
        {visitedTabs.has("tags") && (
          <div style={{ display: subTab === "tags" ? "block" : "none" }}>
            <ChargeUserTags {...props} active={subTab === "tags"} />
          </div>
        )}
      </Suspense>
    </div>
  );
}
