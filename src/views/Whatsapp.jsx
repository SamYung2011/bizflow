import React, { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabaseClient.js";
import { useAppContext } from "../context/AppContext.jsx";
import { useT } from "../i18n.jsx";
import { Input } from "../components/Inputs.jsx";

// 與 App.jsx 同款 fallback（雲端 ext 版本號）
const LATEST_EXT_VERSION_FALLBACK = "1.3.3";

export default function WhatsappView() {
  const { t, lang } = useT();
  const {
    waSettings, setWaSettings,
    waWhitelist, setWaWhitelist,
    waMessages,
    waUnresolved, setWaUnresolved,
    waReports,
    waLogs,
    waClients,
    waHeartbeat,
    isWaAdmin,
    qWaSettings, qWaPending,
  } = useAppContext();
  const queryClient = useQueryClient();

  // ── view-local state（從 App.jsx 搬入）──────────────────────
  const [waSubTab, setWaSubTab] = useState("settings"); // settings | knowledge | prompt | whitelist | messages | unresolved | reports | logs
  const [waSelectedCustomer, setWaSelectedCustomer] = useState(null);
  const [waChannelFilter, setWaChannelFilter] = useState("all"); // all | extension | meta
  const [waSecretUnlocked, setWaSecretUnlocked] = useState(false); // 輸過密碼後這次 session 內放開
  // 解鎖後從 Edge Function wa-unlock 拿到的 openai_api_key 暫存（不寫進 waSettings/cache，避免持久化進 localStorage）
  const [unlockedApiKey, setUnlockedApiKey] = useState("");
  // 安裝教程 modal（僅 WhatsApp tab 用，整個搬進來）
  const [showInstallTutorial, setShowInstallTutorial] = useState(false);

  const s = waSettings || {};
  const subNav = [
    { id: "settings",   label: t("設置 / 模式") },
    { id: "knowledge",  label: t("知識庫") },
    { id: "chargers",   label: t("充電樁 Prompt") },
    { id: "prompt",     label: "Boss Prompt" },
    { id: "whitelist",  label: t("白名單") },
    { id: "messages",   label: t("對話歷史") },
    { id: "pending",    label: t("待發送回覆") },
    { id: "unresolved", label: t("未解決問題") },
    { id: "reports",    label: t("日報") },
    { id: "logs",       label: t("日誌") },
  ];
  const guardAdmin = () => {
    if (!isWaAdmin) { alert(t("您是只讀帳戶，無法編輯 WhatsApp 設置。請聯繫管理員。")); return false; }
    return true;
  };
  const saveSettings = async (patch) => {
    if (!guardAdmin()) return;
    const newVals = { ...s, ...patch, updated_at: new Date().toISOString() };
    const { error } = await supabase.from("wa_settings").update(patch).eq("id", 1);
    if (error) { alert(`${t("保存失敗")}：${error.message}`); return; }
    setWaSettings(newVals);
    queryClient.setQueryData(["bf", "wa_settings"], newVals);
    // fire-and-forget 触发一次 wa-ai-trigger：讓「已超抢答倒計時但還沒等到 cron」的 pending 立即用新 settings 處理
    fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/wa-ai-trigger`, {
      method: "POST",
      headers: { Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
    }).catch(() => { /* silent */ });
  };
  const addWhitelist = async (kind, value, note) => {
    if (!guardAdmin()) return;
    if (!value.trim()) return;
    const { data, error } = await supabase.from("wa_whitelist").insert({ kind, value: value.trim(), note: note?.trim() || null, active: true }).select().single();
    if (error) { alert(`${t("新增失敗")}：${error.message}`); return; }
    setWaWhitelist(prev => [data, ...prev]);
  };
  const removeWhitelist = async (id) => {
    if (!guardAdmin()) return;
    if (!window.confirm(t("確定移除？"))) return;
    const { error } = await supabase.from("wa_whitelist").delete().eq("id", id);
    if (error) { alert(`${t("移除失敗")}：${error.message}`); return; }
    setWaWhitelist(prev => prev.filter(w => w.id !== id));
  };
  const toggleWhitelistActive = async (row) => {
    if (!guardAdmin()) return;
    const { error } = await supabase.from("wa_whitelist").update({ active: !row.active }).eq("id", row.id);
    if (error) { alert(`${t("更新失敗")}：${error.message}`); return; }
    setWaWhitelist(prev => prev.map(w => w.id === row.id ? { ...w, active: !row.active } : w));
  };
  const markUnresolved = async (id) => {
    if (!guardAdmin()) return;
    const { error } = await supabase.from("wa_unresolved").update({ resolved_at: new Date().toISOString() }).eq("id", id);
    if (error) { alert(`${t("更新失敗")}：${error.message}`); return; }
    setWaUnresolved(prev => prev.map(u => u.id === id ? { ...u, resolved_at: new Date().toISOString() } : u));
  };
  // 跳過某條待發送回覆：标 delivered_at + delivery_meta=manual_skip，扩展不再拉
  const skipReply = async (id) => {
    if (!guardAdmin()) return;
    const { error } = await supabase.from("wa_replies").update({ delivered_at: new Date().toISOString(), delivery_meta: { reason: "manual_skip" } }).eq("id", id);
    if (error) { alert(`${t("跳過失敗")}：${error.message}`); return; }
    queryClient.invalidateQueries({ queryKey: ["bf", "wa_replies_pending"] });
  };
  const skipAllReplies = async () => {
    if (!guardAdmin()) return;
    const ids = (qWaPending.data || []).map(r => r.id);
    if (ids.length === 0) return;
    if (!window.confirm(`${t("確定全部跳過")} ${ids.length} ${t("條未發送回覆？")}`)) return;
    const { error } = await supabase.from("wa_replies").update({ delivered_at: new Date().toISOString(), delivery_meta: { reason: "manual_skip" } }).in("id", ids);
    if (error) { alert(`${t("全部跳過失敗")}：${error.message}`); return; }
    queryClient.invalidateQueries({ queryKey: ["bf", "wa_replies_pending"] });
  };
  // 狀態徽標：優先顯示離線（心跳超過 2 分鐘）
  const lastBeat = waHeartbeat?.last_heartbeat_at ? new Date(waHeartbeat.last_heartbeat_at).getTime() : 0;
  const isLive = lastBeat && (Date.now() - lastBeat < 120000);
  const statusCode = !isLive ? (lastBeat ? "offline" : "never") : (waHeartbeat?.status || "unknown");
  const statusMap = {
    running:    { label: t("正常運行"),            color: "#22c55e", bg: "#e8f5e9", dot: "●" },
    starting:   { label: t("啟動中"),              color: "#f59e0b", bg: "#fff8e1", dot: "●" },
    cli_error:  { label: t("CLI 錯誤"),            color: "#ef4444", bg: "#ffe5e5", dot: "●" },
    api_error:  { label: t("API 錯誤"),            color: "#f97316", bg: "#fff1e5", dot: "●" },
    no_network: { label: t("無網絡"),              color: "#9ca3af", bg: "#f3f4f6", dot: "●" },
    offline:    { label: t("離線（本地服務已停）"), color: "#9ca3af", bg: "#f3f4f6", dot: "○" },
    never:      { label: t("未啟動過"),            color: "#9ca3af", bg: "#f3f4f6", dot: "○" },
    unknown:    { label: t("未知"),                color: "#9ca3af", bg: "#f3f4f6", dot: "○" },
  };
  const stInfo = statusMap[statusCode] || statusMap.unknown;
  // 敏感字段編輯密碼門檻（走 wa-unlock Edge Function、server 端比對 + 拿 openai_api_key）
  // 修法見 migration 057 + Edge Function wa-unlock：admin_password / openai_api_key 已 column-level lock、前端拿不到明文
  const ensureUnlocked = async () => {
    if (waSecretUnlocked) return true;
    if (!isWaAdmin) { alert(t("您是只讀帳戶，無法解鎖查看 / 編輯敏感字段（API Key / Boss Prompt 等）。")); return false; }
    const pwd = window.prompt(t("請輸入管理員密碼："));
    if (!pwd || !pwd.trim()) return false;
    try {
      const r = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/wa-unlock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'unlock', pwd: pwd.trim() }),
      });
      const d = await r.json();
      if (r.status === 401 && d.needsInitialPassword) {
        // 首次設密碼流程
        if (!window.confirm(t("尚未設置管理員密碼，是否現在設置？"))) return false;
        const newPwd = window.prompt(t("設置管理員密碼（用於保護 API Key 編輯）："));
        if (!newPwd || !newPwd.trim()) return false;
        const r2 = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/wa-unlock`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'set-initial-password', initialPassword: newPwd.trim() }),
        });
        const d2 = await r2.json();
        if (!r2.ok) { alert(`${t("設置密碼失敗")}：${d2.error || ''}`); return false; }
        setUnlockedApiKey('');
        setWaSecretUnlocked(true);
        return true;
      }
      if (!r.ok || !d.ok) {
        alert(d.error === 'Wrong password' ? t("密碼錯誤") : `${t("解鎖失敗")}：${d.error || ''}`);
        return false;
      }
      setUnlockedApiKey(d.openai_api_key || '');
      setWaSecretUnlocked(true);
      return true;
    } catch (e) {
      alert(`${t("解鎖失敗")}：${e.message}`);
      return false;
    }
  };
  const kindLabel = { phone: t("私聊白名單（手機）"), group: t("群聊白名單（精確）"), group_fuzzy: t("群聊白名單（模糊）"), staff: t("客服名單（手機）") };
  const channelOf = (row) => row?.channel === "meta" ? "meta" : "extension";
  const channelLabel = (channel) => channel === "meta" ? "Meta API" : "Chrome 插件";
  const channelBadgeStyle = (channel) => channel === "meta"
    ? { background: "#e3f2fd", color: "#1565c0", border: "1px solid #bbdefb" }
    : { background: "#f5f5f5", color: "#666", border: "1px solid #e0e0e0" };
  const channelMatches = (row) => waChannelFilter === "all" || channelOf(row) === waChannelFilter;
  const filteredWaMessages = waMessages.filter(channelMatches);
  const filteredWaLogs = waLogs.filter(channelMatches);
  const channelOptions = [
    { id: "all", label: t("全部") },
    { id: "extension", label: t("Chrome 插件") },
    { id: "meta", label: t("Meta API") },
  ];
  const channelFilterBar = (
    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <span style={{ fontSize: 12, color: "#888", fontWeight: 700 }}>{t("通道")}</span>
      {channelOptions.map(opt => (
        <button key={opt.id} onClick={() => { setWaChannelFilter(opt.id); setWaSelectedCustomer(null); }}
          style={{ padding: "5px 10px", borderRadius: 8, border: "1px solid " + (waChannelFilter === opt.id ? "#6382ff" : "#e0e0e0"), background: waChannelFilter === opt.id ? "#eef2ff" : "#fff", color: waChannelFilter === opt.id ? "#3b58d4" : "#666", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
          {opt.label}
        </button>
      ))}
    </div>
  );
  const conversationsMap = new Map();
  for (const m of filteredWaMessages) {
    const key = `${channelOf(m)}:${m.customer_id}`;
    if (!conversationsMap.has(key)) conversationsMap.set(key, []);
    conversationsMap.get(key).push(m);
  }
  const conversationKeys = [...conversationsMap.keys()].sort((a, b) => {
    const la = conversationsMap.get(a);
    const lb = conversationsMap.get(b);
    return new Date(lb[0]?.created_at || 0) - new Date(la[0]?.created_at || 0);
  });

  return (
    <>
      <div>
        {!isWaAdmin && (
          <div style={{ background: "#fff8e1", border: "1px solid #f4dca4", borderRadius: 10, padding: "10px 16px", marginBottom: 14, fontSize: 13, color: "#8a6900" }}>
            🔒 {t("您是")}<b>{t("只讀帳戶")}</b>{t("，可瀏覽 WhatsApp 數據但無法編輯設置 / 知識庫 / 白名單 / Boss Prompt / 標記已解決等。需要編輯請聯繫管理員。")}
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <div>
            <div style={{ fontSize: 26, fontWeight: 800 }}>{t("WhatsApp AI 客服")}</div>
            <div style={{ fontSize: 13, color: "#888", marginTop: 4 }}>
              {t("模式")} <span style={{ fontWeight: 700, color: s.claude_mode === "api" ? "#6382ff" : "#22c55e" }}>{s.claude_mode === "api" ? t("API（雲端）") : t("CLI（本地）")}</span>
              {" · "}{t("共")} {conversationKeys.length} {t("位客戶")} · {filteredWaMessages.length} {t("條消息")} · {waUnresolved.filter(u => !u.resolved_at).length} {t("條未解決")}
            </div>
          </div>
          <div title={waHeartbeat?.error_message || (waHeartbeat?.last_heartbeat_at ? t("心跳：") + new Date(waHeartbeat.last_heartbeat_at).toLocaleString("zh-HK") : t("尚無心跳"))}
            style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 16px", borderRadius: 20, background: stInfo.bg, border: "1px solid " + stInfo.color + "33" }}>
            <span style={{ color: stInfo.color, fontSize: 12, lineHeight: 1 }}>{stInfo.dot}</span>
            <span style={{ color: stInfo.color, fontSize: 13, fontWeight: 700 }}>{stInfo.label}</span>
          </div>
        </div>
        {/* 子導航 */}
        <div style={{ display: "flex", gap: 6, borderBottom: "1px solid #e8eaed", marginBottom: 20, overflowX: "auto" }}>
          {subNav.map(n => (
            <button key={n.id} onClick={() => setWaSubTab(n.id)}
              style={{ padding: "10px 16px", background: "none", border: "none", borderBottom: "2px solid " + (waSubTab === n.id ? "#6382ff" : "transparent"), color: waSubTab === n.id ? "#6382ff" : "#888", fontSize: 14, fontWeight: waSubTab === n.id ? 700 : 500, cursor: "pointer", whiteSpace: "nowrap" }}>
              {n.label}
            </button>
          ))}
        </div>

        {/* SETTINGS */}
        {waSubTab === "settings" && (
          <div style={{ maxWidth: 720 }}>
            <div style={{ background: "#fff", border: "1px solid #f0f0f0", borderRadius: 12, padding: 20, marginBottom: 16 }}>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>{t("AI 模式")}</div>
              <div style={{ display: "flex", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
                {[
                  { v: "cli", l: t("CLI（本地 Claude Code，零費用）") },
                  { v: "api", l: t("API（本地 server.js + OpenAI 兼容）") },
                  { v: "api_cloud", l: t("API 雲端（無需本地 server.js）") },
                ].map(opt => {
                  const on = (s.claude_mode || "cli") === opt.v;
                  return (
                    <button key={opt.v} onClick={() => {
                      if (opt.v === "cli" && (s.claude_mode || "cli") !== "cli") {
                        if (!window.confirm(t("切換到 CLI 模式需要本地開著 Claude Code 終端 + server.js，否則啟用失敗。確認切換？"))) return;
                      }
                      saveSettings({ claude_mode: opt.v });
                    }} style={{ flex: "1 1 200px", padding: "12px 14px", borderRadius: 10, border: "1px solid " + (on ? "#6382ff" : "#e0e0e0"), background: on ? "#eef2ff" : "#fff", color: on ? "#3b58d4" : "#666", fontWeight: 700, fontSize: 13, cursor: "pointer", textAlign: "left" }}>{opt.l}</button>
                  );
                })}
              </div>
              <div style={{ fontSize: 11, color: "#888", lineHeight: 1.6 }}>{t("CLI / API 模式需本地開著 server.js。")}<b>{t("API 雲端")}</b>{t("模式由 Supabase Edge Function + pg_cron 接管，使用者只需安裝 Chrome 雲端版插件。")}</div>
              {(s.claude_mode === "api_cloud") && (() => {
                const LATEST_EXT_VERSION = qWaSettings.data?.latest_ext_version || LATEST_EXT_VERSION_FALLBACK;
                const liveClients = waClients.filter(c => Date.now() - new Date(c.last_seen).getTime() < 25000);
                const outdated = liveClients.filter(c => c.version && c.version !== LATEST_EXT_VERSION);
                return (
                  <div style={{ marginTop: 12, padding: "12px 16px", background: "#fff8e1", border: "1px solid #f4dca4", borderRadius: 8, fontSize: 12, color: "#8a6900", lineHeight: 1.7 }}>
                    ⚠️ {t("雲端模式不支持")} <b>{t("日報自動生成")}</b> {t("與")} <b>{t("Boss Prompt 獨立邏輯")}</b>{t("，這兩個功能仍需本地 server.js 運行。")}<br />
                    {t("雲端 endpoint：")}<code style={{ background: "#fff", padding: "1px 6px", borderRadius: 4, fontSize: 11 }}>https://qxcmimgqsrwkrhqhzpga.supabase.co/functions/v1/wa-message</code>

                    {/* 在線雲端客戶端狀態 */}
                    <div style={{ marginTop: 12, padding: "10px 12px", background: "#fff", borderRadius: 6, border: "1px solid #f4dca4" }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "#333", marginBottom: 6 }}>
                        {t("在線雲端客戶端")}：
                        <span style={{ color: liveClients.length > 0 ? "#22c55e" : "#999", marginLeft: 6 }}>
                          {liveClients.length === 0 ? `0（${t("無人在線")}）` : `${liveClients.length} ${t("個")}`}
                        </span>
                        {outdated.length > 0 && (
                          <span style={{ marginLeft: 10, color: "#c0392b", fontWeight: 700 }}>
                            ⚠️ {outdated.length} {t("個版本落後，請通知對方重新下載")}
                          </span>
                        )}
                      </div>
                      {liveClients.length > 0 && (
                        <div style={{ fontSize: 11, color: "#666", display: "grid", gap: 4 }}>
                          {liveClients.map(c => {
                            const ageS = Math.floor((Date.now() - new Date(c.last_seen).getTime()) / 1000);
                            const isOld = c.version && c.version !== LATEST_EXT_VERSION;
                            return (
                              <div key={c.client_id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                <span style={{ width: 6, height: 6, borderRadius: "50%", background: ageS < 10 ? "#22c55e" : "#f59e0b", display: "inline-block" }}></span>
                                <span style={{ fontFamily: "Consolas, Menlo, monospace" }}>{c.ua || "?"}</span>
                                <span style={{ color: isOld ? "#c0392b" : "#666", fontWeight: isOld ? 700 : 400 }}>v{c.version || "?"}{isOld ? ` ⚠️ → v${LATEST_EXT_VERSION}` : ""}</span>
                                <span style={{ color: "#999" }}>· {ageS}s {t("前")}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* 下載按鈕 + 教程 + 備注 */}
                    <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                      <a href="/whatsapp-extension-cloud.zip" download style={{ padding: "8px 14px", background: "#22c55e", color: "#fff", borderRadius: 8, fontSize: 12, fontWeight: 700, textDecoration: "none" }}>
                        📦 {t("下載 Chrome 插件（雲端版）")} v{LATEST_EXT_VERSION}
                      </a>
                      <button onClick={() => setShowInstallTutorial(true)} style={{ padding: "8px 14px", background: "#fff", color: "#8a6900", border: "1px solid #f4dca4", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                        📖 {t("查看安裝教程")}
                      </button>
                    </div>
                    <div style={{ marginTop: 8, padding: "8px 12px", background: "#fdecea", border: "1px solid #f5c6cb", borderRadius: 6, fontSize: 11, color: "#a32424", lineHeight: 1.6 }}>
                      ❗ {t("如果下載插件後不需要使用，請去 chrome://extensions 關閉插件，否則網頁 WhatsApp 會一直試圖回覆消息。")}
                    </div>
                  </div>
                );
              })()}
            </div>
            <div style={{ background: "#fff", border: "1px solid #f0f0f0", borderRadius: 12, padding: 20, marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div style={{ fontSize: 15, fontWeight: 700 }}>{t("API 配置（API 模式用）")}{!waSecretUnlocked && <span style={{ fontSize: 11, color: "#888", marginLeft: 8 }}>🔒 {t("已鎖定")}</span>}</div>
                {!waSecretUnlocked ? (
                  <button onClick={() => ensureUnlocked()} style={{ padding: "6px 12px", background: "#fff8e1", color: "#f59e0b", border: "1px solid #f4dca4", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>🔓 {t("解鎖編輯")}</button>
                ) : <span style={{ fontSize: 11, color: "#22c55e", fontWeight: 600 }}>✓ {t("已解鎖")}</span>}
              </div>
              <Input label="Base URL" value={s.openai_base_url || ""} onChange={v => setWaSettings({ ...s, openai_base_url: v })} placeholder="https://api.openai.com/v1" readOnly={!waSecretUnlocked} />
              <div style={{ fontSize: 11, color: "#888", marginBottom: 14, marginTop: -8 }}>{t("也支持任何 OpenAI 兼容中轉站 / 本地模型")}</div>
              <Input label="API Key" value={waSecretUnlocked ? unlockedApiKey : "••••••••••••（解鎖編輯後可見）"} onChange={v => setUnlockedApiKey(v)} placeholder="sk-..." readOnly={!waSecretUnlocked} />
              <Input label="Model" value={s.model || ""} onChange={v => setWaSettings({ ...s, model: v })} placeholder="gpt-4o" readOnly={!waSecretUnlocked} />
              <div style={{ display: "flex", gap: 10 }}>
                <button disabled={!waSecretUnlocked} onClick={async () => {
                  // 非敏感欄位走普通 saveSettings
                  await saveSettings({ openai_base_url: s.openai_base_url, model: s.model });
                  // 敏感 api_key 走 Edge Function wa-unlock save-secrets（需 pwd 二次校驗）
                  const pwd = window.prompt(t("再次輸入管理員密碼以保存 API Key（敏感操作）："));
                  if (!pwd || !pwd.trim()) { alert(t("已保存 Base URL / Model，API Key 未更新（需要密碼確認）")); return; }
                  try {
                    const r = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/wa-unlock`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ action: 'save-secrets', pwd: pwd.trim(), newApiKey: unlockedApiKey }),
                    });
                    const d = await r.json();
                    if (!r.ok || !d.ok) { alert(d.error === 'Wrong password' ? t("密碼錯誤、API Key 未更新") : `${t("保存 API Key 失敗")}：${d.error || ''}`); return; }
                    alert(t("已保存"));
                  } catch (e) { alert(`${t("保存 API Key 失敗")}：${e.message}`); }
                }} style={{ padding: "9px 18px", background: waSecretUnlocked ? "#6382ff" : "#e0e0e0", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: waSecretUnlocked ? "pointer" : "not-allowed" }}>{t("儲存 API 配置")}</button>
                <button disabled={!s.openai_base_url || !unlockedApiKey || !s.model} onClick={async () => {
                  try {
                    const r = await fetch(s.openai_base_url.replace(/\/+$/, '') + '/chat/completions', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + unlockedApiKey },
                      body: JSON.stringify({ model: s.model, messages: [{ role: 'user', content: 'ping（只需回復 pong）' }], max_tokens: 8192 })
                    });
                    const d = await r.json();
                    const content = d.choices?.[0]?.message?.content;
                    if (r.ok && content) {
                      alert(`✓ ${t("連接成功")}\n${t("模型回復")}：${content.slice(0, 100)}`);
                    } else if (r.ok) {
                      // HTTP 200 但 content 空：常見於推理模型（reasoner）max_tokens 不夠 / 響應結構特殊
                      const finishReason = d.choices?.[0]?.finish_reason || 'unknown';
                      const usage = d.usage ? `tokens=${d.usage.completion_tokens}/${d.usage.total_tokens}` : '';
                      alert(`⚠️ ${t("HTTP 200 但回復為空")}（finish_reason=${finishReason} ${usage}）\n${t("推理模型可能 max_tokens 用光在思考上。完整響應：")}\n${JSON.stringify(d).slice(0, 400)}`);
                    } else {
                      alert(`✗ ${t("連接失敗")} (${r.status})：${d.error?.message || JSON.stringify(d).slice(0, 200)}`);
                    }
                  } catch (err) {
                    alert(`✗ ${t("網絡錯誤")}：${err.message}`);
                  }
                }} style={{ padding: "9px 18px", background: (!s.openai_base_url || !unlockedApiKey || !s.model) ? "#e0e0e0" : "#22c55e", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: (s.openai_base_url && unlockedApiKey && s.model) ? "pointer" : "not-allowed" }}>{t("測試連接")}</button>
              </div>
            </div>
            <div style={{ background: "#fff", border: "1px solid #f0f0f0", borderRadius: 12, padding: 20 }}>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>{t("運行參數")}</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
                <Input label={t("BOT 名字（AI 自稱，注入 prompt）")} value={s.bot_name || ""} onChange={v => setWaSettings({ ...s, bot_name: v })} placeholder={t("例如 Allen / 小克")} />
                <Input label={t("BOT WhatsApp 手機號（純數字）")} value={s.bot_phone || ""} onChange={v => setWaSettings({ ...s, bot_phone: v })} placeholder="852xxxxxxxx" />
                <Input label={t("特殊聊天名（BOSS_CHAT_NAME）")} value={s.boss_chat_name || ""} onChange={v => setWaSettings({ ...s, boss_chat_name: v })} placeholder="" />
                <Input label={t("真人抢答等待秒數")} type="number" value={s.reply_delay_base ?? 60} onChange={v => setWaSettings({ ...s, reply_delay_base: parseInt(v) || 60 })} />
                <Input label={t("冷卻分鐘（真人回復後）")} type="number" value={s.cooldown_minutes ?? 30} onChange={v => setWaSettings({ ...s, cooldown_minutes: parseInt(v) || 30 })} />
                <Input label={t("每用戶每分鐘上限")} type="number" value={s.max_replies_per_min ?? 3} onChange={v => setWaSettings({ ...s, max_replies_per_min: parseInt(v) || 3 })} />
                <Input label={t("日報發送時（0-23）")} type="number" value={s.daily_report_hour ?? 22} onChange={v => setWaSettings({ ...s, daily_report_hour: parseInt(v) || 22 })} />
              </div>
              <button onClick={() => saveSettings({ bot_name: s.bot_name, bot_phone: s.bot_phone, boss_chat_name: s.boss_chat_name, reply_delay_base: s.reply_delay_base, cooldown_minutes: s.cooldown_minutes, max_replies_per_min: s.max_replies_per_min, daily_report_hour: s.daily_report_hour })} style={{ padding: "9px 18px", background: "#6382ff", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer", marginTop: 8 }}>{t("儲存運行參數")}</button>
            </div>
          </div>
        )}

        {/* KNOWLEDGE */}
        {waSubTab === "knowledge" && (() => {
          const serverKb = qWaSettings.data?.knowledge || "";
          const localKb = s.knowledge || "";
          const dirty = localKb !== serverKb;
          return (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div style={{ fontSize: 13, color: "#888" }}>{t("這裡是 AI 客服回答問題時用的知識庫，本地 server.js 每條消息處理時實時拉取最新版本。")}</div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  {dirty && <span style={{ fontSize: 11, color: "#f59e0b", fontWeight: 600 }}>● {t("未儲存")}</span>}
                  <button disabled={!dirty} onClick={() => saveSettings({ knowledge: localKb })} style={{ padding: "7px 18px", background: dirty ? "#22c55e" : "#e0e0e0", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: dirty ? "pointer" : "not-allowed" }}>{t("儲存知識庫")}</button>
                  {dirty && <button onClick={() => setWaSettings({ ...s, knowledge: serverKb })} style={{ padding: "7px 14px", background: "#f5f5f5", color: "#666", border: "none", borderRadius: 8, fontSize: 12, cursor: "pointer" }}>{t("取消")}</button>}
                </div>
              </div>
              <textarea value={localKb} onChange={e => setWaSettings({ ...s, knowledge: e.target.value })} placeholder={t("# 產品線 1 ...")} style={{ width: "100%", minHeight: "60vh", padding: 16, borderRadius: 10, border: "1px solid " + (dirty ? "#f59e0b" : "#e0e0e0"), fontSize: 13, outline: "none", fontFamily: "ui-monospace, monospace", resize: "vertical", boxSizing: "border-box" }} />
              <div style={{ fontSize: 11, color: "#aaa", marginTop: 8 }}>{localKb.length} {t("字符")}{dirty ? t("（與雲端不同，點「儲存知識庫」才生效）") : " · " + t("已同步")}</div>
            </div>
          );
        })()}

        {/* 充電樁 PROMPT（雲端模式 EPD 查詢相關 prompt，bizflow 改了即時生效，無需 redeploy edge function） */}
        {waSubTab === "chargers" && (() => {
          const serverCp = qWaSettings.data?.chargers_prompt || "";
          const localCp = s.chargers_prompt || "";
          const cpDirty = localCp !== serverCp;
          const serverLh = qWaSettings.data?.location_hint_prompt || "";
          const localLh = s.location_hint_prompt || "";
          const lhDirty = localLh !== serverLh;
          return (
            <div style={{ display: "grid", gap: 24 }}>
              <div style={{ fontSize: 13, color: "#888", lineHeight: 1.6 }}>
                {t("這裡是雲端 AI 客服處理充電樁查詢相關的兩段 prompt。安全規則仍是硬編碼不可改。")}
              </div>

              {/* 充電樁服務說明 */}
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: "#333" }}>{t("充電樁服務說明")}</div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    {cpDirty && <span style={{ fontSize: 11, color: "#f59e0b", fontWeight: 600 }}>● {t("未儲存")}</span>}
                    <button disabled={!cpDirty} onClick={() => saveSettings({ chargers_prompt: localCp })} style={{ padding: "6px 14px", background: cpDirty ? "#22c55e" : "#e0e0e0", color: "#fff", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: cpDirty ? "pointer" : "not-allowed" }}>{t("儲存")}</button>
                    {cpDirty && <button onClick={() => setWaSettings({ ...s, chargers_prompt: serverCp })} style={{ padding: "6px 12px", background: "#f5f5f5", color: "#666", border: "none", borderRadius: 8, fontSize: 12, cursor: "pointer" }}>{t("取消")}</button>}
                  </div>
                </div>
                <div style={{ fontSize: 11, color: "#888", marginBottom: 6 }}>{t("AI 系統提示詞末尾追加的充電樁服務介紹。客戶咨詢充電站時 AI 用這裡的話術引導。")}</div>
                <textarea value={localCp} onChange={e => setWaSettings({ ...s, chargers_prompt: e.target.value })} style={{ width: "100%", minHeight: 200, padding: 14, borderRadius: 10, border: "1px solid " + (cpDirty ? "#f59e0b" : "#e0e0e0"), fontSize: 12, outline: "none", fontFamily: "ui-monospace, monospace", resize: "vertical", boxSizing: "border-box" }} />
                <div style={{ fontSize: 11, color: "#aaa", marginTop: 4 }}>{localCp.length} {t("字符")}</div>
              </div>

              {/* 位置注入模板 */}
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: "#333" }}>{t("位置注入模板")}</div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    {lhDirty && <span style={{ fontSize: 11, color: "#f59e0b", fontWeight: 600 }}>● {t("未儲存")}</span>}
                    <button disabled={!lhDirty} onClick={() => saveSettings({ location_hint_prompt: localLh })} style={{ padding: "6px 14px", background: lhDirty ? "#22c55e" : "#e0e0e0", color: "#fff", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: lhDirty ? "pointer" : "not-allowed" }}>{t("儲存")}</button>
                    {lhDirty && <button onClick={() => setWaSettings({ ...s, location_hint_prompt: serverLh })} style={{ padding: "6px 12px", background: "#f5f5f5", color: "#666", border: "none", borderRadius: 8, fontSize: 12, cursor: "pointer" }}>{t("取消")}</button>}
                  </div>
                </div>
                <div style={{ fontSize: 11, color: "#888", marginBottom: 6, lineHeight: 1.6 }}>
                  {t("客戶發位置消息時，系統查 EPD 後注入給 AI 的參考資料模板。必須含兩個占位符：")}
                  <code style={{ background: "#fff8e1", padding: "1px 5px", borderRadius: 3 }}>{"{LOCATION_DESC}"}</code>
                  {t(" 和 ")}
                  <code style={{ background: "#fff8e1", padding: "1px 5px", borderRadius: 3 }}>{"{STATIONS_OR_EMPTY}"}</code>
                  {t("（保存時會檢查，缺一個就用默認模板兜底）")}
                </div>
                <textarea value={localLh} onChange={e => setWaSettings({ ...s, location_hint_prompt: e.target.value })} style={{ width: "100%", minHeight: 280, padding: 14, borderRadius: 10, border: "1px solid " + (lhDirty ? "#f59e0b" : "#e0e0e0"), fontSize: 12, outline: "none", fontFamily: "ui-monospace, monospace", resize: "vertical", boxSizing: "border-box" }} />
                <div style={{ fontSize: 11, color: "#aaa", marginTop: 4 }}>
                  {localLh.length} {t("字符")} ·
                  {localLh.includes("{LOCATION_DESC}") ? <span style={{ color: "#22c55e", marginLeft: 6 }}>✓ {"{LOCATION_DESC}"}</span> : <span style={{ color: "#c0392b", marginLeft: 6 }}>✗ {t("缺")} {"{LOCATION_DESC}"}</span>}
                  {localLh.includes("{STATIONS_OR_EMPTY}") ? <span style={{ color: "#22c55e", marginLeft: 6 }}>✓ {"{STATIONS_OR_EMPTY}"}</span> : <span style={{ color: "#c0392b", marginLeft: 6 }}>✗ {t("缺")} {"{STATIONS_OR_EMPTY}"}</span>}
                </div>
              </div>
            </div>
          );
        })()}

        {/* BOSS PROMPT */}
        {waSubTab === "prompt" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ fontSize: 13, color: "#888" }}>{t("該聊天（BOSS_CHAT_NAME）走的是獨立 prompt，不走客服知識庫。")}{!waSecretUnlocked && <span style={{ marginLeft: 6, color: "#f59e0b", fontWeight: 600 }}>🔒 {t("已鎖定")}</span>}</div>
              {!waSecretUnlocked ? (
                <button onClick={() => ensureUnlocked()} style={{ padding: "6px 12px", background: "#fff8e1", color: "#f59e0b", border: "1px solid #f4dca4", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>🔓 {t("解鎖編輯")}</button>
              ) : <span style={{ fontSize: 11, color: "#22c55e", fontWeight: 600 }}>✓ {t("已解鎖")}</span>}
            </div>
            {waSecretUnlocked ? (
              <>
                <textarea value={s.boss_prompt || ""}
                  onChange={e => setWaSettings({ ...s, boss_prompt: e.target.value })}
                  onBlur={() => saveSettings({ boss_prompt: s.boss_prompt || "" })}
                  placeholder={t("你的名字叫小克...")}
                  style={{ width: "100%", minHeight: "50vh", padding: 16, borderRadius: 10, border: "1px solid #e0e0e0", fontSize: 13, outline: "none", fontFamily: "ui-monospace, monospace", resize: "vertical", boxSizing: "border-box", background: "#fff", color: "#222" }} />
                <div style={{ fontSize: 11, color: "#aaa", marginTop: 8 }}>{t("失焦自動保存")} · {(s.boss_prompt || "").length} {t("字符")}</div>
              </>
            ) : (
              <div style={{ width: "100%", minHeight: "50vh", padding: "80px 24px", borderRadius: 10, border: "1px dashed #e0e0e0", background: "#fafbfc", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, color: "#aaa", fontSize: 13, textAlign: "center", boxSizing: "border-box" }}>
                <div style={{ fontSize: 32 }}>🔒</div>
                <div style={{ fontWeight: 700, color: "#888", fontSize: 15 }}>{t("Boss Prompt 已加密")}</div>
                <div style={{ color: "#aaa", fontSize: 12 }}>{t("目前有")} {(s.boss_prompt || "").length} {t("字符內容")}<br />{t("點右上角「解鎖編輯」輸入管理員密碼查看 / 修改")}</div>
              </div>
            )}
          </div>
        )}

        {/* WHITELIST */}
        {waSubTab === "whitelist" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
            {["phone", "group", "group_fuzzy", "staff"].map(kind => {
              const rows = waWhitelist.filter(w => w.kind === kind);
              return (
                <div key={kind} style={{ background: "#fff", border: "1px solid #f0f0f0", borderRadius: 12, padding: 16 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>{kindLabel[kind]} <span style={{ color: "#aaa", fontSize: 11, marginLeft: 6 }}>{rows.length}</span></div>
                  <form onSubmit={e => { e.preventDefault(); const f = e.target.elements; addWhitelist(kind, f.val.value, f.note.value); f.val.value = ""; f.note.value = ""; }} style={{ display: "flex", gap: 6, marginBottom: 12 }}>
                    <input name="val" placeholder={kind === "phone" || kind === "staff" ? "852xxx" : t("群名")} style={{ flex: 2, padding: "7px 10px", borderRadius: 8, border: "1px solid #e0e0e0", fontSize: 12, outline: "none" }} />
                    <input name="note" placeholder={t("備註（可選）")} style={{ flex: 1, padding: "7px 10px", borderRadius: 8, border: "1px solid #e0e0e0", fontSize: 12, outline: "none" }} />
                    <button type="submit" style={{ padding: "7px 14px", background: "#6382ff", color: "#fff", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>{t("加")}</button>
                  </form>
                  {rows.length === 0 ? (
                    <div style={{ fontSize: 11, color: "#aaa", fontStyle: "italic", padding: "8px 0" }}>{t("尚無記錄")}</div>
                  ) : rows.map(w => (
                    <div key={w.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0", borderBottom: "1px solid #f5f5f5", fontSize: 12 }}>
                      <input type="checkbox" checked={w.active} onChange={() => toggleWhitelistActive(w)} style={{ width: 14, height: 14, cursor: "pointer" }} />
                      <span style={{ flex: 1, color: w.active ? "#222" : "#aaa", textDecoration: w.active ? "none" : "line-through" }}>{w.value}{w.note ? <span style={{ color: "#999", marginLeft: 6 }}>· {w.note}</span> : null}</span>
                      <button onClick={() => removeWhitelist(w.id)} style={{ background: "none", border: "none", color: "#ccc", cursor: "pointer", fontSize: 14 }}>×</button>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}

        {/* MESSAGES */}
        {waSubTab === "messages" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, gap: 12, flexWrap: "wrap" }}>
              <div />
              {channelFilterBar}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 14, minHeight: "60vh" }}>
              <div style={{ background: "#fff", border: "1px solid #f0f0f0", borderRadius: 12, overflow: "hidden", display: "flex", flexDirection: "column" }}>
                <div style={{ padding: "12px 14px", borderBottom: "1px solid #f0f0f0", fontSize: 13, fontWeight: 700 }}>{t("客戶")} <span style={{ color: "#aaa", marginLeft: 4 }}>{conversationKeys.length}</span></div>
                <div style={{ flex: 1, overflowY: "auto" }}>
                  {conversationKeys.length === 0 ? <div style={{ padding: 16, fontSize: 12, color: "#aaa", fontStyle: "italic" }}>{t("尚無對話")}</div>
                  : conversationKeys.map(key => {
                    const msgs = conversationsMap.get(key);
                    const latest = msgs[0] || {};
                    const channel = channelOf(latest);
                    const active = waSelectedCustomer === key;
                    return (
                      <div key={key} onClick={() => setWaSelectedCustomer(key)} style={{ padding: "10px 14px", borderBottom: "1px solid #f5f5f5", cursor: "pointer", background: active ? "#eef2ff" : "transparent" }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: active ? "#3b58d4" : "#333", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{latest.customer_id}</div>
                        <div style={{ fontSize: 11, color: "#999", marginTop: 4, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                          <span style={{ ...channelBadgeStyle(channel), borderRadius: 999, padding: "1px 6px", fontSize: 10, fontWeight: 700 }}>{t(channelLabel(channel))}</span>
                          <span>{msgs.length} {t("條")}</span>
                          <span>{latest.created_at?.slice(5, 16).replace("T", " ") || ""}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div style={{ background: "#fff", border: "1px solid #f0f0f0", borderRadius: 12, padding: 16, overflowY: "auto", maxHeight: "70vh" }}>
                {!waSelectedCustomer ? <div style={{ color: "#aaa", fontSize: 13, textAlign: "center", paddingTop: 80 }}>{t("← 從左側選擇客戶查看對話")}</div>
                : (() => {
                  const msgs = [...(conversationsMap.get(waSelectedCustomer) || [])].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
                  const first = msgs[0] || {};
                  const selectedChannel = channelOf(first);
                  return (
                    <>
                      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, paddingBottom: 10, borderBottom: "1px solid #f0f0f0", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <span>{first.customer_id || "—"} · {msgs.length} {t("條")}</span>
                        <span style={{ ...channelBadgeStyle(selectedChannel), borderRadius: 999, padding: "1px 7px", fontSize: 10, fontWeight: 700 }}>{t(channelLabel(selectedChannel))}</span>
                      </div>
                      {msgs.map(m => {
                        const channel = channelOf(m);
                        return (
                          <div key={m.id} style={{ marginBottom: 12, display: "flex", justifyContent: m.role === "assistant" ? "flex-start" : "flex-end" }}>
                            <div style={{ maxWidth: "75%", background: m.role === "assistant" ? "#f0f4ff" : "#e8f5e9", borderRadius: 10, padding: "8px 12px", fontSize: 13, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
                              {m.content}
                              <div style={{ fontSize: 10, color: "#999", marginTop: 4, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                                <span>{new Date(m.created_at).toLocaleString("zh-HK", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                                <span style={{ ...channelBadgeStyle(channel), borderRadius: 999, padding: "0 6px", fontSize: 10, fontWeight: 700 }}>{t(channelLabel(channel))}</span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </>
                  );
                })()}
              </div>
            </div>
          </div>
        )}

        {/* PENDING REPLIES — 已生成但插件还没发送的回覆 */}
        {waSubTab === "pending" && (() => {
          const pending = qWaPending.data || [];
          return (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div style={{ fontSize: 13, color: "#888" }}>{t("共")} {pending.length} {t("條未發送回覆")}{pending.length > 0 && ` · ${t("跳過後插件不再嘗試發送")}`}</div>
                {pending.length > 0 && (
                  <button onClick={skipAllReplies} style={{ background: "#fce4ec", border: "none", color: "#c0392b", borderRadius: 8, padding: "6px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>{t("全部跳過")}</button>
                )}
              </div>
              {pending.length === 0 ? (
                <div style={{ background: "#fff", borderRadius: 10, padding: 40, textAlign: "center", color: "#aaa", border: "1px dashed #e0e0e0" }}>{t("暫無待發送回覆")}</div>
              ) : pending.map(r => {
                const segs = typeof r.segments === "string" ? (() => { try { return JSON.parse(r.segments); } catch { return []; } })() : (r.segments || []);
                const preview = segs.length === 0 ? t("（空回覆）") : segs.map(s => typeof s === "string" ? s : (s.content || (s.type === "image" ? `[${t("圖片")}: ${s.url || ""}]` : ""))).join(" / ").slice(0, 200);
                const ageMin = Math.floor((Date.now() - new Date(r.created_at).getTime()) / 60000);
                const channel = channelOf(r);
                return (
                  <div key={r.id} style={{ background: "#fff", border: "1px solid #fce4ec", borderRadius: 10, padding: "12px 16px", marginBottom: 8, display: "flex", gap: 12, alignItems: "flex-start" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: "#222", wordBreak: "break-word" }}>{preview || t("（無內容）")}</div>
                      <div style={{ fontSize: 11, color: "#888", marginTop: 4, display: "flex", gap: 10, flexWrap: "wrap" }}>
                        <span style={{ ...channelBadgeStyle(channel), borderRadius: 999, padding: "1px 6px", fontSize: 10, fontWeight: 700 }}>{t(channelLabel(channel))}</span>
                        <span>{r.chat_name || r.customer_id || "—"}</span>
                        <span>{segs.length} {t("段")}</span>
                        <span>{new Date(r.created_at).toLocaleString("zh-HK", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                        {ageMin > 0 && <span style={{ color: ageMin > 5 ? "#c0392b" : "#888" }}>{ageMin}{t("分鐘前")}</span>}
                      </div>
                    </div>
                    <button onClick={() => skipReply(r.id)} style={{ background: "#fce4ec", border: "none", color: "#c0392b", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>× {t("跳過")}</button>
                  </div>
                );
              })}
            </div>
          );
        })()}

        {/* UNRESOLVED */}
        {waSubTab === "unresolved" && (
          <div>
            <div style={{ fontSize: 13, color: "#888", marginBottom: 10 }}>{t("共")} {waUnresolved.length} {t("條")} · {t("未處理")} {waUnresolved.filter(u => !u.resolved_at).length} · {t("已解決")} {waUnresolved.filter(u => u.resolved_at).length}</div>
            {waUnresolved.length === 0 ? (
              <div style={{ background: "#fff", borderRadius: 10, padding: 40, textAlign: "center", color: "#aaa", border: "1px dashed #e0e0e0" }}>{t("暫無未解決問題")}</div>
            ) : waUnresolved.map(u => (
              <div key={u.id} style={{ background: "#fff", border: "1px solid " + (u.resolved_at ? "#e8f5e9" : "#fce4ec"), borderRadius: 10, padding: "12px 16px", marginBottom: 8, display: "flex", gap: 12, alignItems: "flex-start" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: u.resolved_at ? "#999" : "#222", textDecoration: u.resolved_at ? "line-through" : "none" }}>{u.question}</div>
                  <div style={{ fontSize: 11, color: "#888", marginTop: 4, display: "flex", gap: 10 }}>
                    <span>{u.customer_id}</span>
                    <span>{(u.categories || []).join(" · ") || t("未分類")}</span>
                    <span>{new Date(u.created_at).toLocaleString("zh-HK", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                </div>
                {!u.resolved_at && <button onClick={() => markUnresolved(u.id)} style={{ background: "#e8f5e9", border: "none", color: "#22c55e", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>✓ {t("標記已解決")}</button>}
                {u.resolved_at && <span style={{ fontSize: 11, color: "#22c55e", whiteSpace: "nowrap" }}>✓ {new Date(u.resolved_at).toLocaleString("zh-HK", { month: "2-digit", day: "2-digit" })}</span>}
              </div>
            ))}
          </div>
        )}

        {/* REPORTS */}
        {waSubTab === "reports" && (
          <div>
            <div style={{ fontSize: 13, color: "#888", marginBottom: 10 }}>{t("共")} {waReports.length} {t("份日報")}</div>
            {waReports.length === 0 ? (
              <div style={{ background: "#fff", borderRadius: 10, padding: 40, textAlign: "center", color: "#aaa", border: "1px dashed #e0e0e0" }}>{t("暫無日報（server.js 每日")} {s.daily_report_hour ?? 22}{t(":00 自動生成）")}</div>
            ) : waReports.map(r => (
              <details key={r.id} style={{ background: "#fff", border: "1px solid #f0f0f0", borderRadius: 10, padding: "14px 18px", marginBottom: 10 }}>
                <summary style={{ cursor: "pointer", fontSize: 14, fontWeight: 700 }}>{r.report_date} <span style={{ fontSize: 11, color: "#888", marginLeft: 10, fontWeight: 500 }}>{r.unresolved_count} {t("條未解決")}</span></summary>
                <pre style={{ marginTop: 10, fontSize: 12, color: "#333", whiteSpace: "pre-wrap", fontFamily: "inherit", lineHeight: 1.6 }}>{r.content}</pre>
              </details>
            ))}
          </div>
        )}

        {waSubTab === "logs" && (() => {
          // 雲端 log message 翻譯（regex 替換固定 pattern，保留數字 / URL / 變量）
          // server.js 後端固定中文 → 前端 lang === en 時翻成英文 message
          const translateLogMsg = (msg) => {
            if (typeof msg !== "string" || lang === "zh") return msg;
            if (lang === "en") {
              return msg
                .replace(/^服务端运行在 (.+) \(CLI模式\)$/, "Server running at $1 (CLI mode)")
                .replace(/^服务端运行在 (.+) \(API模式\)$/, "Server running at $1 (API mode)")
                .replace(/^已同步雲端配置（knowledge (\d+) 字 \/ boss_prompt (\d+) 字）$/, "Synced cloud config (knowledge $1 chars / boss_prompt $2 chars)")
                .replace(/^同步失敗：(.+)$/, "Sync failed: $1")
                .replace(/^存消息失敗：(.+)$/, "Failed to save message: $1")
                .replace(/^存未解決失敗：(.+)$/, "Failed to save unresolved: $1")
                .replace(/^存日報失敗：(.+)$/, "Failed to save daily report: $1")
                .replace(/^模式=(\S+) \| 模型=(.+?) \| 延迟=(\d+s) \| 冷却=(\d+min)$/, "Mode=$1 | Model=$2 | Delay=$3 | Cooldown=$4")
                .replace(/^Bot=未设置 \| 私聊白名单=(.*)$/, "Bot=Not set | Whitelist=$1")
                .replace(/^Bot=(\S+) \| 私聊白名单=(.*)$/, "Bot=$1 | Whitelist=$2")
                .replace(/^群聊白名单=(.*?) \| 群聊模糊=(.*)$/, "Group whitelist=$1 | Group fuzzy=$2")
                .replace(/^群聊白名单=无 \| 群聊模糊=(.*)$/, "Group whitelist=none | Group fuzzy=$1")
                .replace(/^配置已通过面板更新$/, "Config updated via panel")
                .replace(/^从磁盘恢复 (\d+) 个已回复客户记录$/, "Restored $1 replied-customer records from disk")
                .replace(/^雲端切換 (\S+) → (\S+)$/, "Cloud switch $1 → $2")
                .replace(/^已通过面板更新 \((\d+) 字\)，即時生效$/, "Updated via panel ($1 chars), live")
                .replace(/^配置已更新，关闭当前服务后重启\.\.\.$/, "Config updated, closing current service to restart...")
                .replace(/^已删除 (\d+) 个过期聊天记录$/, "Cleaned $1 expired chat records")
                .replace(/^清扫失败: (.+)$/, "Cleanup failed: $1")
                .replace(/^Claude CLI 不可用，请在浏览器中切换到 API 模式$/, "Claude CLI unavailable, switch to API mode in browser");
            }
            if (lang === "fr") {
              return msg
                .replace(/^服务端运行在 (.+) \(CLI模式\)$/, "Serveur en cours d'exécution sur $1 (mode CLI)")
                .replace(/^服务端运行在 (.+) \(API模式\)$/, "Serveur en cours d'exécution sur $1 (mode API)")
                .replace(/^已同步雲端配置（knowledge (\d+) 字 \/ boss_prompt (\d+) 字）$/, "Configuration cloud synchronisée (knowledge $1 car. / boss_prompt $2 car.)")
                .replace(/^同步失敗：(.+)$/, "Échec de synchronisation : $1")
                .replace(/^存消息失敗：(.+)$/, "Échec de l'enregistrement du message : $1")
                .replace(/^存未解決失敗：(.+)$/, "Échec de l'enregistrement du non-résolu : $1")
                .replace(/^存日報失敗：(.+)$/, "Échec de l'enregistrement du rapport quotidien : $1")
                .replace(/^模式=(\S+) \| 模型=(.+?) \| 延迟=(\d+s) \| 冷却=(\d+min)$/, "Mode=$1 | Modèle=$2 | Délai=$3 | Refroidissement=$4")
                .replace(/^Bot=未设置 \| 私聊白名单=(.*)$/, "Bot=Non défini | Liste blanche=$1")
                .replace(/^Bot=(\S+) \| 私聊白名单=(.*)$/, "Bot=$1 | Liste blanche=$2")
                .replace(/^群聊白名单=(.*?) \| 群聊模糊=(.*)$/, "Liste blanche groupe=$1 | Groupe flou=$2")
                .replace(/^群聊白名单=无 \| 群聊模糊=(.*)$/, "Liste blanche groupe=aucun | Groupe flou=$1")
                .replace(/^配置已通过面板更新$/, "Configuration mise à jour via le panneau")
                .replace(/^从磁盘恢复 (\d+) 个已回复客户记录$/, "Restauration de $1 enregistrements de clients déjà répondus depuis le disque")
                .replace(/^雲端切換 (\S+) → (\S+)$/, "Bascule cloud $1 → $2")
                .replace(/^已通过面板更新 \((\d+) 字\)，即時生效$/, "Mise à jour via le panneau ($1 car.), effective immédiatement")
                .replace(/^配置已更新，关闭当前服务后重启\.\.\.$/, "Configuration mise à jour, fermeture du service actuel pour redémarrer...")
                .replace(/^已删除 (\d+) 个过期聊天记录$/, "Suppression de $1 enregistrements de chat expirés")
                .replace(/^清扫失败: (.+)$/, "Échec du nettoyage : $1")
                .replace(/^Claude CLI 不可用，请在浏览器中切换到 API 模式$/, "Claude CLI indisponible, basculez en mode API dans le navigateur");
            }
            return msg;
          };
          const catColor = {
            // 服務生命週期 — 綠
            "启动":     { bg: "#e8f5e9", color: "#22863a" },
            "重启":     { bg: "#e8f5e9", color: "#22863a" },
            "恢复":     { bg: "#e8f5e9", color: "#22863a" },
            // 配置 — 藍
            "配置":     { bg: "#e3f2fd", color: "#1565c0" },
            "模式":     { bg: "#e3f2fd", color: "#1565c0" },
            "知识库":   { bg: "#e3f2fd", color: "#1565c0" },
            // 雲端同步 — 紫
            "Supabase": { bg: "#f3e5f5", color: "#7b1fa2" },
            "Meta-Webhook": { bg: "#e3f2fd", color: "#1565c0" },
            "Meta-Status": { bg: "#e3f2fd", color: "#1565c0" },
            // 維護任務 — 橙
            "清扫":     { bg: "#fff3e0", color: "#a65a00" },
            "日报":     { bg: "#fff3e0", color: "#a65a00" },
            "操作":     { bg: "#fff3e0", color: "#a65a00" },
            // 錯誤 — 紅
            "错误":     { bg: "#fdecea", color: "#c0392b" },
            // 對話流（內容已雲端脫敏）— 灰
            "收到":     { bg: "#f5f5f5", color: "#555" },
            "回复入队": { bg: "#f5f5f5", color: "#555" },
            "历史":     { bg: "#f5f5f5", color: "#555" },
            // 流控 — 黃
            "跳过":     { bg: "#fff8e1", color: "#8a6900" },
            "退避":     { bg: "#fff8e1", color: "#8a6900" },
            "限流":     { bg: "#fff8e1", color: "#8a6900" },
            // 處理中 — 藍淺
            "生成":     { bg: "#e1f5fe", color: "#01579b" },
            "等待":     { bg: "#e1f5fe", color: "#01579b" },
            "位置-注入": { bg: "#e1f5fe", color: "#01579b" },
            // 待處理 — 紅淺
            "未解决":   { bg: "#fff0f0", color: "#a32424" },
            // 圖片 — 中性
            "图片":     { bg: "#f5f5f5", color: "#555" },
          };
          return (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, gap: 12, flexWrap: "wrap" }}>
                <div style={{ fontSize: 13, color: "#888" }}>
                  {t("共")} {filteredWaLogs.length} {t("條")} · {t("雲端保留 24 小時 · 5s 自動刷新")}
                  <span style={{ marginLeft: 10, color: "#aaa", fontSize: 12 }}>
                    {t("（收到/回復入隊/未解決的客戶原話自動脫敏）")}
                  </span>
                </div>
                {channelFilterBar}
              </div>
              {filteredWaLogs.length === 0 ? (
                <div style={{ background: "#fff", borderRadius: 10, padding: 40, textAlign: "center", color: "#aaa", border: "1px dashed #e0e0e0" }}>
                  {t("暫無日誌（等 server.js 重啟後或下次同步出問題時會自動填）")}
                </div>
              ) : (
                <div style={{ background: "#fff", border: "1px solid #f0f0f0", borderRadius: 10, padding: 12, maxHeight: "70vh", overflowY: "auto", fontFamily: "Consolas, Menlo, monospace", fontSize: 12, lineHeight: 1.7 }}>
                  {filteredWaLogs.map(r => {
                    const c = catColor[r.category] || { bg: "#f5f5f5", color: "#666" };
                    const channel = channelOf(r);
                    const ts = new Date(r.created_at).toLocaleString(lang === "en" ? "en-HK" : lang === "fr" ? "fr-FR" : "zh-HK", { hour12: false });
                    return (
                      <div key={r.id} style={{ display: "flex", gap: 10, padding: "4px 0", borderBottom: "1px solid #fafafa" }}>
                        <span style={{ color: "#999", flexShrink: 0, width: 140 }}>{ts}</span>
                        <span style={{ background: c.bg, color: c.color, padding: "1px 8px", borderRadius: 4, fontSize: 11, fontWeight: 700, flexShrink: 0, alignSelf: "center", minWidth: 60, textAlign: "center" }}>{t(r.category)}</span>
                        <span style={{ ...channelBadgeStyle(channel), borderRadius: 999, padding: "1px 7px", fontSize: 10, fontWeight: 700, flexShrink: 0, alignSelf: "center" }}>{t(channelLabel(channel))}</span>
                        <span style={{ color: "#333", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{translateLogMsg(r.message)}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })()}
      </div>

      {/* INSTALL TUTORIAL MODAL（從 App.jsx 搬入 — 僅 WhatsApp tab 用） */}
      {showInstallTutorial && (
        <div onClick={() => setShowInstallTutorial(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 2100, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: 28, width: 600, maxWidth: "100%", maxHeight: "90vh", overflowY: "auto", boxShadow: "0 10px 40px rgba(0,0,0,0.25)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <div style={{ fontSize: 20, fontWeight: 800 }}>📖 {t("Chrome 插件安裝教程")}</div>
              <button onClick={() => setShowInstallTutorial(false)} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#999" }}>×</button>
            </div>

            <div style={{ marginBottom: 22 }}>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 10, color: "#22c55e" }}>🆕 {t("首次安裝")}</div>
              <ol style={{ paddingLeft: 20, fontSize: 13, color: "#333", lineHeight: 1.9, margin: 0 }}>
                <li>{t("點擊上面綠色「下載 Chrome 插件」按鈕，下載 zip")}</li>
                <li>{t("解壓 zip（右鍵 → 解壓全部 / Mac 雙擊）到任意資料夾")}</li>
                <li>{t("在 Chrome 地址欄輸入：")}<code style={{ background: "#f5f5f5", padding: "1px 6px", borderRadius: 3, fontSize: 12 }}>chrome://extensions</code>{t("（不加 https）")}</li>
                <li>{t("打開右上角「開發者模式」開關")}</li>
                <li>{t("點擊左上角「載入已解壓的擴充功能」")}</li>
                <li>{t("選擇剛才解壓的資料夾，確認")}</li>
                <li>{t("看到「WhatsApp AI 客服 (雲端)」出現在列表 = 成功")}</li>
                <li>{t("打開 web.whatsapp.com，登入 WhatsApp Web，插件自動運行")}</li>
              </ol>
            </div>

            <div style={{ marginBottom: 22 }}>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 10, color: "#6382ff" }}>🔄 {t("更新版本（推薦快速法）")}</div>
              <ol style={{ paddingLeft: 20, fontSize: 13, color: "#333", lineHeight: 1.9, margin: 0 }}>
                <li>{t("下載新版 zip 並解壓，覆蓋到原來的資料夾（路徑保持不變）")}</li>
                <li>{t("打開 chrome://extensions")}</li>
                <li>{t("找到「WhatsApp AI 客服 (雲端)」卡片，點右下角的🔄「重新載入」按鈕")}</li>
                <li>{t("重新打開 web.whatsapp.com，新版自動運行")}</li>
              </ol>
              <div style={{ marginTop: 10, padding: "8px 12px", background: "#fafafa", borderRadius: 6, fontSize: 12, color: "#666" }}>
                {t("如果新版解壓到不同資料夾（怕舊文件殘留），則需先「移除」舊扩展，再重新點「載入已解壓的擴充功能」選新資料夾。")}
              </div>
              <div style={{ marginTop: 10, padding: "8px 12px", background: "#e3f2fd", borderRadius: 6, fontSize: 12, color: "#1565c0" }}>
                💡 {t("為什麼要更新：WhatsApp Web 經常更新內部代碼，舊版插件可能點擊聊天失敗、扫不到未讀。版本落後時這個頁面會紅字提示。")}
              </div>
            </div>

            <div>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 10, color: "#c0392b" }}>⚠️ {t("不需要使用時")}</div>
              <ol style={{ paddingLeft: 20, fontSize: 13, color: "#333", lineHeight: 1.9, margin: 0 }}>
                <li>{t("打開 chrome://extensions")}</li>
                <li>{t("找到「WhatsApp AI 客服 (雲端)」")}</li>
                <li>{t("關閉右下角開關（變灰）= 暫停運行")}</li>
                <li>{t("或點「移除」徹底刪除插件")}</li>
              </ol>
              <div style={{ marginTop: 10, padding: "8px 12px", background: "#fdecea", borderRadius: 6, fontSize: 12, color: "#a32424" }}>
                ❗ {t("不關閉的話，只要瀏覽器開著 WhatsApp Web，插件就會一直自動回復客戶消息。")}
              </div>
            </div>

            <div style={{ marginTop: 22, textAlign: "right" }}>
              <button onClick={() => setShowInstallTutorial(false)} style={{ padding: "10px 24px", background: "#6382ff", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                {t("我明白了")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
