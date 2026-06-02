import React, { useState } from "react";
import { Input } from "../../components/Inputs.jsx";

const META_SECRET_FIELDS = [
  {
    key: "meta_access_token",
    label: "Meta 永久訪問令牌",
    hint: "讓我們後台代表公司 WhatsApp 帳號發消息的「鑰匙」。在 Meta 後台 System User 處生成。只在 Meta 提醒過期、或重發系統時才需要換。",
  },
  {
    key: "meta_app_secret",
    label: "Meta 應用密鑰",
    hint: "用來確認 Meta 推給我們的客戶消息是真的、不是假冒的。在 Meta 開發者後台「應用 → 設定 → 基本資料」裡。基本上配一次就不用動。",
  },
  {
    key: "meta_tts_relay_token",
    label: "語音伺服器內部密碼",
    hint: "我們後台跟語音伺服器互信的密碼。改了立即生效，不需要重啟伺服器。保險起見換之前先告知技術。",
  },
];

const CARD = { background: "#fff", border: "1px solid #f0f0f0", borderRadius: 12, padding: 20, marginBottom: 16 };
const LABEL = { fontSize: 13, fontWeight: 700, color: "#555", display: "block", marginBottom: 5 };
const HINT = { fontSize: 11, color: "#888", lineHeight: 1.6, marginTop: -8, marginBottom: 14 };
const SECTION_DESC = { fontSize: 12, color: "#666", lineHeight: 1.7, marginBottom: 14 };

function HelpedInput({ label, value, onChange, placeholder, hint }) {
  return (
    <div>
      <Input label={label} value={value} onChange={onChange} placeholder={placeholder} />
      {hint && <div style={HINT}>{hint}</div>}
    </div>
  );
}

export default function MetaConfigPanel({
  s,
  setWaSettings,
  saveSettings,
  guardAdmin,
  t,
}) {
  const [secretMasks, setSecretMasks] = useState({});
  const [editingSecret, setEditingSecret] = useState(null);
  const [secretDrafts, setSecretDrafts] = useState({});
  const [secretSaving, setSecretSaving] = useState(null);
  const [plainSaving, setPlainSaving] = useState(false);

  const callUnlock = async (body) => {
    const r = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/wa-unlock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    if (!r.ok || !d.ok) throw new Error(d.error || `HTTP ${r.status}`);
    return d;
  };

  const loadSecretMasks = async () => {
    if (!guardAdmin()) return;
    const pwd = window.prompt(t("輸入管理員密碼查看遮罩："));
    if (!pwd || !pwd.trim()) return;
    try {
      const d = await callUnlock({ action: "meta-masks", pwd: pwd.trim() });
      setSecretMasks(d.meta_secrets || {});
    } catch (e) {
      alert(`${t("讀取失敗")}：${e.message}`);
    }
  };

  const savePlainMetaConfig = async () => {
    setPlainSaving(true);
    try {
      const ok = await saveSettings({
        wa_outbound_mode: s.wa_outbound_mode || "extension",
        meta_graph_version: s.meta_graph_version || "v25.0",
        meta_phone_number_id: s.meta_phone_number_id || null,
        meta_waba_id: s.meta_waba_id || null,
        meta_webhook_verify_token: s.meta_webhook_verify_token || null,
        meta_tts_enabled: s.meta_tts_enabled !== false,
        meta_tts_relay_url: s.meta_tts_relay_url || null,
        meta_tts_voice_id: s.meta_tts_voice_id || null,
        meta_tts_language_boost: s.meta_tts_language_boost || null,
        meta_tts_prompt: s.meta_tts_prompt || "",
      });
      if (ok) alert(t("已儲存"));
    } finally {
      setPlainSaving(false);
    }
  };

  const saveMetaSecret = async (field) => {
    if (!guardAdmin()) return;
    const nextValue = String(secretDrafts[field] || "").trim();
    if (!nextValue) {
      alert(t("新鑰匙不能為空"));
      return;
    }
    if (!window.confirm(t("確定換新鑰匙？舊鑰匙作廢，明文無法找回。"))) return;
    const pwd = window.prompt(t("再次輸入管理員密碼確認："));
    if (!pwd || !pwd.trim()) return;
    setSecretSaving(field);
    try {
      const d = await callUnlock({
        action: "save-secrets",
        pwd: pwd.trim(),
        metaSecrets: { [field]: nextValue },
      });
      setSecretMasks(d.meta_secrets || {});
      setSecretDrafts(prev => ({ ...prev, [field]: "" }));
      setEditingSecret(null);
      alert(t("新鑰匙已生效"));
    } catch (e) {
      alert(`${t("保存失敗")}：${e.message}`);
    } finally {
      setSecretSaving(null);
    }
  };

  const renderSecretField = (field) => {
    const editing = editingSecret === field.key;
    const mask = secretMasks[field.key] || "";
    return (
      <div key={field.key} style={{ border: "1px solid #f0f0f0", borderRadius: 10, padding: 14, background: "#fafbfc" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", marginBottom: 8 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#333" }}>{t(field.label)}</div>
            <div style={{ fontSize: 11, color: "#888", lineHeight: 1.6, marginTop: 4 }}>{t(field.hint)}</div>
          </div>
          <button
            type="button"
            onClick={() => setEditingSecret(editing ? null : field.key)}
            style={{ padding: "6px 12px", background: "#fff", color: "#6382ff", border: "1px solid #dbe3ff", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}
          >
            {editing ? t("取消") : t("換新鑰匙")}
          </button>
        </div>
        <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 13, color: mask ? "#333" : "#aaa", background: "#fff", border: "1px solid #eceff3", borderRadius: 8, padding: "8px 10px", marginBottom: editing ? 10 : 0 }}>
          {mask || t("尚未查看（點上方「輸入密碼查看遮罩」）")}
        </div>
        {editing && (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="password"
              value={secretDrafts[field.key] || ""}
              onChange={e => setSecretDrafts(prev => ({ ...prev, [field.key]: e.target.value }))}
              placeholder={t("貼入新鑰匙")}
              style={{ flex: 1, minWidth: 0, padding: "9px 12px", borderRadius: 8, border: "1px solid #e0e0e0", fontSize: 13, outline: "none", boxSizing: "border-box" }}
            />
            <button
              type="button"
              disabled={secretSaving === field.key}
              onClick={() => saveMetaSecret(field.key)}
              style={{ padding: "9px 14px", background: secretSaving === field.key ? "#d1d5db" : "#6382ff", color: "#fff", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: secretSaving === field.key ? "not-allowed" : "pointer", whiteSpace: "nowrap" }}
            >
              {t("保存新鑰匙")}
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ maxWidth: 900 }}>
      <div style={{ background: "#fff8e1", border: "1px solid #f4dca4", borderRadius: 10, padding: "12px 14px", marginBottom: 16, fontSize: 12, color: "#8a6900", lineHeight: 1.7 }}>
        ⚠ {t("這一頁是 WhatsApp 官方接口的連接配置。配置一次基本不動；改錯可能導致客服收不到消息或無法回覆。每個欄位下方都寫了「是什麼 / 什麼時候改」。")}
      </div>

      <div style={CARD}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", marginBottom: 8 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 4 }}>{t("官方 WhatsApp 接口連接")}</div>
            <div style={SECTION_DESC}>{t("告訴系統「我們公司的 WhatsApp 商業帳號是哪個、客服號碼是哪個、Meta 那邊用哪個版本接口」。基本上煊煊配一次就不用動了。")}</div>
          </div>
          <button
            type="button"
            onClick={savePlainMetaConfig}
            disabled={plainSaving}
            style={{ padding: "9px 18px", background: plainSaving ? "#d1d5db" : "#6382ff", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: plainSaving ? "not-allowed" : "pointer", whiteSpace: "nowrap" }}
          >
            {t("儲存設置")}
          </button>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={LABEL}>{t("舊版出站開關（已停用）")}</label>
          <select
            value={s.wa_outbound_mode || "extension"}
            onChange={e => setWaSettings({ ...s, wa_outbound_mode: e.target.value })}
            style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid #e0e0e0", fontSize: 14, outline: "none", background: "#fff", boxSizing: "border-box" }}
          >
            <option value="extension">{t("Chrome 擴展（舊）")}</option>
            <option value="meta-cloud">{t("Meta 官方接口")}</option>
          </select>
          <div style={{ fontSize: 11, color: "#888", lineHeight: 1.6, marginTop: 6 }}>{t("以前用這個開關控制「全部消息走 Chrome 擴展、還是走 Meta 官方」。現在改成按聊天自動分流（群聊走擴展、私聊走 Meta），這個開關已經不再生效。保留只為兼容舊配置，不用改。")}</div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
          <HelpedInput
            label={t("Meta 接口版本")}
            value={s.meta_graph_version || ""}
            onChange={v => setWaSettings({ ...s, meta_graph_version: v })}
            placeholder="v25.0"
            hint={t("Meta 給我們用的接口版本號。Meta 升級停用舊版時才改，平常不動。目前 v25.0。")}
          />
          <HelpedInput
            label={t("客服號碼 ID")}
            value={s.meta_phone_number_id || ""}
            onChange={v => setWaSettings({ ...s, meta_phone_number_id: v })}
            placeholder="1234567890"
            hint={t("客服 WhatsApp 號碼在 Meta 後台的內部編號（不是手機號本身）。換客服號才改，在 Meta 商家設定 → WhatsApp 帳戶 → 電話號碼裡找。")}
          />
          <HelpedInput
            label={t("WhatsApp 商業帳號 ID")}
            value={s.meta_waba_id || ""}
            onChange={v => setWaSettings({ ...s, meta_waba_id: v })}
            placeholder="1234567890"
            hint={t("整個公司 WhatsApp 商業帳號的編號。幾乎不會變，除非公司換主體重新申請。")}
          />
          <HelpedInput
            label={t("Meta 回調驗證密碼")}
            value={s.meta_webhook_verify_token || ""}
            onChange={v => setWaSettings({ ...s, meta_webhook_verify_token: v })}
            placeholder="verify token"
            hint={t("Meta 把客戶消息推給我們時，雙方對一下這個密碼確認對得上。這邊改了一定要同步去 Meta 開發者後台 webhook 那裡改成一樣的，否則消息收不到。")}
          />
        </div>
      </div>

      <div style={CARD}>
        <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 4 }}>{t("AI 語音回覆設置")}</div>
        <div style={SECTION_DESC}>{t("客戶私聊時，AI 部分回覆會發粵語語音消息（位置、導航、充電樁問題仍發文字）。")}</div>

        <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, fontSize: 13, fontWeight: 700, color: "#555" }}>
          <input type="checkbox" checked={s.meta_tts_enabled !== false} onChange={e => setWaSettings({ ...s, meta_tts_enabled: e.target.checked })} />
          {t("開啟 AI 語音回覆")}
        </label>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
          <HelpedInput
            label={t("語音伺服器地址")}
            value={s.meta_tts_relay_url || ""}
            onChange={v => setWaSettings({ ...s, meta_tts_relay_url: v })}
            placeholder="http://wa-tts-relay:8091/send-tts"
            hint={t("公司內部生成語音的伺服器地址。不要改，改了語音就發不出去。")}
          />
          <HelpedInput
            label={t("語音音色")}
            value={s.meta_tts_voice_id || ""}
            onChange={v => setWaSettings({ ...s, meta_tts_voice_id: v })}
            placeholder=""
            hint={t("克隆好的粵語客服聲音 ID。想換成另一個音色才改這裡。")}
          />
          <HelpedInput
            label={t("語言加強")}
            value={s.meta_tts_language_boost || ""}
            onChange={v => setWaSettings({ ...s, meta_tts_language_boost: v })}
            placeholder="Chinese,Yue"
            hint={t("告訴語音引擎以什麼語言/口音為主生成。目前是「Chinese,Yue」= 中文粵語。除非想換語種，不用動。")}
          />
        </div>

        <label style={LABEL}>{t("語音人設台詞")}</label>
        <div style={{ fontSize: 11, color: "#888", lineHeight: 1.6, marginBottom: 8 }}>
          {t("告訴 AI 用什麼語氣、什麼人設說話（例如「你是 Honnmono 粵語客服，語速適中，親切」）。想換語氣可以改，保留默認也行。")}
        </div>
        <textarea
          value={s.meta_tts_prompt || ""}
          onChange={e => setWaSettings({ ...s, meta_tts_prompt: e.target.value })}
          style={{ width: "100%", minHeight: 180, padding: 14, borderRadius: 10, border: "1px solid #e0e0e0", fontSize: 13, outline: "none", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", resize: "vertical", boxSizing: "border-box" }}
        />
        <div style={{ fontSize: 11, color: "#aaa", marginTop: 6 }}>{(s.meta_tts_prompt || "").length} {t("字符")}</div>
      </div>

      <div style={CARD}>
        <div style={{ background: "#fff1f1", border: "1px solid #f5c6c6", borderRadius: 10, padding: "12px 14px", marginBottom: 14, fontSize: 12, color: "#a02020", lineHeight: 1.7 }}>
          ⚠ <b>{t("以下三個是「密碼級」鑰匙")}</b>{t("：洩漏 = 別人可以冒充我們公司發消息、讀客戶消息。明文絕對不會顯示出來，只會顯示前 4 + 後 4 位讓你確認鑰匙還在。換之前先問技術。")}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", marginBottom: 14 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 4 }}>{t("機密鑰匙")}</div>
            <div style={SECTION_DESC}>{t("點右邊按鈕、輸入管理員密碼後，會顯示遮罩讓你確認鑰匙還在。要換新值點每行的「換新鑰匙」。")}</div>
          </div>
          <button
            type="button"
            onClick={loadSecretMasks}
            style={{ padding: "8px 14px", background: "#fff8e1", color: "#8a6900", border: "1px solid #f4dca4", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}
          >
            {t("輸入密碼查看遮罩")}
          </button>
        </div>
        <div style={{ display: "grid", gap: 10 }}>
          {META_SECRET_FIELDS.map(renderSecretField)}
        </div>
      </div>
    </div>
  );
}
