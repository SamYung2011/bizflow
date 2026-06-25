import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { useT } from "../i18n.jsx";
import { Icon } from "../components/Icon.jsx";

// 狀態顏色 + label key（label 走 t() 翻譯）
const STATUS_COLOR = {
  interested: "#6382ff",
  pending_visit: "#f59e0b",
  visit_scheduled: "#8b5cf6",
  measuring: "#16a34a",
  measured: "#64748b",
};
const STATUS_LABEL = {
  interested: "意向登記",
  pending_visit: "待安排上門",
  visit_scheduled: "已安排上門",
  measuring: "測量中",
  measured: "測量完成",
};
// 「上門估價」子頁覆蓋的狀態（含測量完成的收尾態）
const SURVEY_STATUSES = ["pending_visit", "visit_scheduled", "measuring", "measured"];

export default function ChargerLeadsView() {
  const { t } = useT();
  const [subTab, setSubTab] = useState("intent"); // intent | survey
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [surveyBucket, setSurveyBucket] = useState("all"); // all | pending_visit | visit_scheduled | measuring
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [quotingId, setQuotingId] = useState(null); // 哪條正在填安裝費報價
  const [quoteVal, setQuoteVal] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("charger_leads")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) setErr(error.message);
    else { setErr(""); setLeads(data || []); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // 狀態推進（樂觀更新本地）
  const advance = async (id, newStatus, extra = {}) => {
    setBusyId(id);
    const { error } = await supabase.from("charger_leads").update({ status: newStatus, ...extra }).eq("id", id);
    setBusyId(null);
    if (error) { setErr(error.message); return; }
    setLeads(prev => prev.map(l => (l.id === id ? { ...l, status: newStatus, ...extra } : l)));
  };

  const q = search.toLowerCase().trim();
  const matchSearch = (l) =>
    !q ||
    (l.name || "").toLowerCase().includes(q) ||
    (l.phone || "").toLowerCase().includes(q) ||
    (l.phone_mainland || "").toLowerCase().includes(q) ||
    (l.address || "").toLowerCase().includes(q) ||
    (l.charger_model || "").toLowerCase().includes(q) ||
    (Array.isArray(l.selected_products) ? l.selected_products.join(" ") : "").toLowerCase().includes(q);

  const intentLeads = leads.filter(l => l.status === "interested").filter(matchSearch);
  const surveyAllLeads = leads.filter(l => SURVEY_STATUSES.includes(l.status));
  const surveyLeads = surveyAllLeads
    .filter(l => surveyBucket === "all" || l.status === surveyBucket)
    .filter(matchSearch);

  const subNav = [
    { id: "intent", label: t("意向登記"), count: leads.filter(l => l.status === "interested").length },
    { id: "survey", label: t("上門估價"), count: surveyAllLeads.length },
  ];

  const bucketBtns = [
    { k: "all", label: t("全部") },
    { k: "pending_visit", label: t("待安排上門") },
    { k: "visit_scheduled", label: t("已安排上門") },
    { k: "measuring", label: t("測量中") },
    { k: "measured", label: t("測量完成") },
  ];

  const renderCard = (l) => {
    const color = STATUS_COLOR[l.status] || "#888";
    const dateStr = (l.created_at || "").slice(0, 16).replace("T", " ");
    return (
      <div key={l.id} style={{ background: "#fff", borderRadius: 12, padding: "14px 18px", border: "1px solid #f0f0f0", boxShadow: "0 2px 6px rgba(0,0,0,0.02)", display: "flex", gap: 14 }}>
        <div style={{ width: 6, alignSelf: "stretch", background: color, borderRadius: 3 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* 主行：姓名 + 電話 + 狀態 */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 800, fontSize: 15 }}>{l.name || t("(未填名)")}</span>
            {l.phone && <span style={{ fontSize: 12, color: "#888" }}>· {l.phone}</span>}
            {l.phone_mainland && <span style={{ fontSize: 12, color: "#888" }}>· {l.phone_mainland}</span>}
            <span style={{ fontSize: 11, color, fontWeight: 700, padding: "2px 8px", background: color + "18", borderRadius: 8 }}>
              {t(STATUS_LABEL[l.status] || l.status)}
            </span>
            {l.pending_merge_cid && (
              <span style={{ fontSize: 11, color: "#dc2626", fontWeight: 700, padding: "2px 8px", background: "#fee2e2", borderRadius: 8 }}>
                {t("疑似老客戶待合併")}
              </span>
            )}
          </div>
          {/* 次行：產品 / 安裝服務 / 車型 */}
          <div style={{ fontSize: 13, color: "#444", marginBottom: 2 }}>
            {l.charger_model && <span style={{ fontWeight: 600 }}>{l.charger_model}</span>}
            {l.install_service && <span style={{ color: "#666" }}> · {t("安裝服務")}: {l.install_service}</span>}
            {(l.car_make || l.car_model) && <span style={{ color: "#888" }}> · {[l.car_make, l.car_model].filter(Boolean).join(" ")}</span>}
          </div>
          {/* 勾選的配件（7 個產品複選）*/}
          {Array.isArray(l.selected_products) && l.selected_products.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, margin: "4px 0 2px" }}>
              {l.selected_products.map((p, i) => (
                <span key={i} style={{ fontSize: 11, color: "#6382ff", background: "#eef2ff", padding: "1px 7px", borderRadius: 6 }}>{p}</span>
              ))}
            </div>
          )}
          {/* 地址 */}
          {l.address && (
            <div style={{ fontSize: 12, color: "#888", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {t("地址")}: {l.address}
            </div>
          )}
          {/* 安裝費報價（測量完成後填）*/}
          {l.quoted_fee != null && (
            <div style={{ fontSize: 13, color: "#16a34a", fontWeight: 700, marginTop: 3 }}>
              {t("安裝費報價")}: HK$ {Number(l.quoted_fee).toLocaleString()}
            </div>
          )}
          {/* 底行：時間 + 推薦人 */}
          <div style={{ fontSize: 11, color: "#aaa", marginTop: 3 }}>
            {dateStr}{l.referral ? ` · ${t("推薦人")}: ${l.referral}` : ""}
          </div>
        </div>
        {/* 右側：狀態推進按鈕 */}
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 6, flexShrink: 0 }}>
          {l.status === "interested" && (
            <ActionBtn busy={busyId === l.id} color="#f59e0b" onClick={() => advance(l.id, "pending_visit")}>{t("轉上門估價")}</ActionBtn>
          )}
          {l.status === "pending_visit" && (
            <ActionBtn busy={busyId === l.id} color="#8b5cf6" onClick={() => advance(l.id, "visit_scheduled")}>{t("安排上門")}</ActionBtn>
          )}
          {l.status === "visit_scheduled" && (
            <ActionBtn busy={busyId === l.id} color="#16a34a" onClick={() => advance(l.id, "measuring")}>{t("開始測量")}</ActionBtn>
          )}
          {l.status === "measuring" && quotingId !== l.id && (
            <ActionBtn busy={busyId === l.id} color="#64748b" onClick={() => { setQuotingId(l.id); setQuoteVal(""); }}>{t("測量完成")}</ActionBtn>
          )}
          {l.status === "measuring" && quotingId === l.id && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
              <input type="number" autoFocus placeholder={t("安裝費報價") + " HK$"} value={quoteVal}
                onChange={e => setQuoteVal(e.target.value)}
                style={{ width: 130, padding: "6px 8px", border: "1px solid #cbd5e1", borderRadius: 8, fontSize: 13 }} />
              <div style={{ display: "flex", gap: 4 }}>
                <ActionBtn busy={busyId === l.id} color="#16a34a"
                  onClick={() => { advance(l.id, "measured", { quoted_fee: quoteVal === "" ? null : Number(quoteVal) }); setQuotingId(null); }}>
                  {t("確認")}
                </ActionBtn>
                <button onClick={() => setQuotingId(null)}
                  style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid #e0e0e0", background: "#fff", color: "#888", fontSize: 13, cursor: "pointer" }}>
                  {t("取消")}
                </button>
              </div>
            </div>
          )}
          {l.status === "measured" && (
            <span style={{ fontSize: 12, color: "#64748b", fontWeight: 700 }}>{t("測量完成")}</span>
          )}
        </div>
      </div>
    );
  };

  const currentList = subTab === "intent" ? intentLeads : surveyLeads;

  return (
    <div>
      {/* 標題 */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>{t("充電樁意向表單")}</h1>
        <p style={{ color: "#888", margin: "4px 0 0", fontSize: 14 }}>
          {t("官網 Framer 表單提交的充電樁購買意向，跟進到上門估價")}
        </p>
      </div>

      {/* sub-tab bar */}
      <div style={{ display: "flex", gap: 6, borderBottom: "1px solid #e8eaed", marginBottom: 18 }}>
        {subNav.map(n => (
          <button key={n.id} onClick={() => setSubTab(n.id)}
            style={{ padding: "10px 16px", background: "none", border: "none", borderBottom: "2px solid " + (subTab === n.id ? "#6382ff" : "transparent"), color: subTab === n.id ? "#6382ff" : "#888", fontSize: 14, fontWeight: subTab === n.id ? 700 : 500, cursor: "pointer", whiteSpace: "nowrap" }}>
            {n.label} ({n.count})
          </button>
        ))}
      </div>

      {/* 上門估價子頁：三狀態篩選 */}
      {subTab === "survey" && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
          {bucketBtns.map(b => {
            const cnt = b.k === "all" ? surveyAllLeads.length : surveyAllLeads.filter(l => l.status === b.k).length;
            const c = b.k === "all" ? "#555" : STATUS_COLOR[b.k];
            const on = surveyBucket === b.k;
            return (
              <button key={b.k} onClick={() => setSurveyBucket(b.k)}
                style={{ padding: "7px 14px", borderRadius: 20, border: on ? `2px solid ${c}` : "1px solid #e0e0e0", background: on ? c + "18" : "#fff", color: on ? c : "#555", fontSize: 13, fontWeight: on ? 700 : 500, cursor: "pointer" }}>
                {b.label} ({cnt})
              </button>
            );
          })}
        </div>
      )}

      {/* 搜索框 */}
      <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #f0f0f0", padding: "10px 14px", marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
        <Icon name="search" size={15} />
        <input placeholder={t("搜尋姓名 / 電話 / 地址 / 產品…")} value={search} onChange={e => setSearch(e.target.value)}
          style={{ border: "none", background: "none", outline: "none", fontSize: 14, width: "100%" }} />
      </div>

      {/* 列表 */}
      {loading ? (
        <div style={{ padding: 40, textAlign: "center", color: "#999" }}>{t("加載中")}…</div>
      ) : err ? (
        <div style={{ padding: 40, textAlign: "center", color: "#dc2626" }}>{t("加載失敗")}: {err}</div>
      ) : currentList.length === 0 ? (
        <div style={{ padding: 40, textAlign: "center", color: "#999" }}>{t("暫無記錄")}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {currentList.map(renderCard)}
        </div>
      )}
    </div>
  );
}

function ActionBtn({ children, onClick, color, busy }) {
  return (
    <button onClick={onClick} disabled={busy}
      style={{ padding: "8px 14px", borderRadius: 10, border: "none", background: busy ? "#ccc" : color, color: "#fff", fontSize: 13, fontWeight: 700, cursor: busy ? "default" : "pointer", whiteSpace: "nowrap" }}>
      {children}
    </button>
  );
}
