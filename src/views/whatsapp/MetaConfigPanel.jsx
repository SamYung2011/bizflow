import React, { useState } from "react";
import { Input } from "../../components/Inputs.jsx";

const META_SECRET_FIELDS = [
  { key: "meta_access_token", label: "Meta Access Token", hint: "Meta System User Permanent Token" },
  { key: "meta_app_secret", label: "Meta App Secret", hint: "Webhook X-Hub-Signature-256" },
  { key: "meta_tts_relay_token", label: "TTS Relay Token", hint: "Internal TTS Relay shared token" },
];

const CARD = { background: "#fff", border: "1px solid #f0f0f0", borderRadius: 12, padding: 20, marginBottom: 16 };
const LABEL = { fontSize: 13, fontWeight: 700, color: "#555", display: "block", marginBottom: 5 };
const HELP = { fontSize: 11, color: "#888", lineHeight: 1.6 };

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
    const pwd = window.prompt(t("輸入管理員密碼以讀取遮罩："));
    if (!pwd || !pwd.trim()) return;
    try {
      const d = await callUnlock({ action: "meta-masks", pwd: pwd.trim() });
      setSecretMasks(d.meta_secrets || {});
    } catch (e) {
      alert(`${t("遮罩讀取失敗")}：${e.message}`);
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
      if (ok) alert(t("Meta 配置已保存"));
    } finally {
      setPlainSaving(false);
    }
  };

  const saveMetaSecret = async (field) => {
    if (!guardAdmin()) return;
    const nextValue = String(secretDrafts[field] || "").trim();
    if (!nextValue) {
      alert(t("新值不能為空"));
      return;
    }
    if (!window.confirm(t("確定重置此敏感欄位？舊值不會顯示。"))) return;
    const pwd = window.prompt(t("再次輸入管理員密碼以保存敏感欄位："));
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
      alert(t("敏感欄位已更新"));
    } catch (e) {
      alert(`${t("保存敏感欄位失敗")}：${e.message}`);
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
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#333" }}>{t(field.label)}</div>
            <div style={HELP}>{t(field.hint)}</div>
          </div>
          <button
            type="button"
            onClick={() => setEditingSecret(editing ? null : field.key)}
            style={{ padding: "6px 12px", background: "#fff", color: "#6382ff", border: "1px solid #dbe3ff", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}
          >
            {editing ? t("取消重置") : t("重置")}
          </button>
        </div>
        <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 13, color: mask ? "#333" : "#aaa", background: "#fff", border: "1px solid #eceff3", borderRadius: 8, padding: "8px 10px", marginBottom: editing ? 10 : 0 }}>
          {mask || t("未解鎖")}
        </div>
        {editing && (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="password"
              value={secretDrafts[field.key] || ""}
              onChange={e => setSecretDrafts(prev => ({ ...prev, [field.key]: e.target.value }))}
              placeholder={t("輸入新值")}
              style={{ flex: 1, minWidth: 0, padding: "9px 12px", borderRadius: 8, border: "1px solid #e0e0e0", fontSize: 13, outline: "none", boxSizing: "border-box" }}
            />
            <button
              type="button"
              disabled={secretSaving === field.key}
              onClick={() => saveMetaSecret(field.key)}
              style={{ padding: "9px 14px", background: secretSaving === field.key ? "#d1d5db" : "#6382ff", color: "#fff", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: secretSaving === field.key ? "not-allowed" : "pointer", whiteSpace: "nowrap" }}
            >
              {t("保存新值")}
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ maxWidth: 900 }}>
      <div style={CARD}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 4 }}>{t("Meta Cloud API 配置")}</div>
            <div style={HELP}>{t("管理 Meta 官方 Cloud API 出站、webhook 與語音 relay 設置。敏感 token 只可重置，不能查看明文。")}</div>
          </div>
          <button
            type="button"
            onClick={savePlainMetaConfig}
            disabled={plainSaving}
            style={{ padding: "9px 18px", background: plainSaving ? "#d1d5db" : "#6382ff", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: plainSaving ? "not-allowed" : "pointer", whiteSpace: "nowrap" }}
          >
            {t("儲存 Meta 配置")}
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
          <div style={{ marginBottom: 14 }}>
            <label style={LABEL}>{t("全局出站模式（已棄用）")}</label>
            <select
              value={s.wa_outbound_mode || "extension"}
              onChange={e => setWaSettings({ ...s, wa_outbound_mode: e.target.value })}
              style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid #e0e0e0", fontSize: 14, outline: "none", background: "#fff", boxSizing: "border-box" }}
            >
              <option value="extension">{t("Chrome Extension（舊）")}</option>
              <option value="meta-cloud">{t("Meta Cloud API")}</option>
            </select>
            <div style={{ ...HELP, marginTop: 6 }}>{t("此字段已不再控制實際出站；現在每條消息按 channel 決定 extension 或 meta-cloud。保留只為兼容舊配置。")}</div>
          </div>
          <Input label={t("Graph API 版本")} value={s.meta_graph_version || ""} onChange={v => setWaSettings({ ...s, meta_graph_version: v })} placeholder="v25.0" />
          <Input label={t("Phone Number ID")} value={s.meta_phone_number_id || ""} onChange={v => setWaSettings({ ...s, meta_phone_number_id: v })} placeholder="1234567890" />
          <Input label={t("WABA ID")} value={s.meta_waba_id || ""} onChange={v => setWaSettings({ ...s, meta_waba_id: v })} placeholder="1234567890" />
          <Input label={t("Webhook Verify Token")} value={s.meta_webhook_verify_token || ""} onChange={v => setWaSettings({ ...s, meta_webhook_verify_token: v })} placeholder="verify token" />
        </div>
      </div>

      <div style={CARD}>
        <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 14 }}>{t("Meta TTS 設置")}</div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, fontSize: 13, fontWeight: 700, color: "#555" }}>
          <input type="checkbox" checked={s.meta_tts_enabled !== false} onChange={e => setWaSettings({ ...s, meta_tts_enabled: e.target.checked })} />
          {t("啟用 Meta 語音 TTS")}
        </label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
          <Input label={t("TTS Relay URL")} value={s.meta_tts_relay_url || ""} onChange={v => setWaSettings({ ...s, meta_tts_relay_url: v })} placeholder="http://wa-tts-relay:8091/send-tts" />
          <Input label={t("Voice ID")} value={s.meta_tts_voice_id || ""} onChange={v => setWaSettings({ ...s, meta_tts_voice_id: v })} placeholder="" />
          <Input label={t("Language Boost")} value={s.meta_tts_language_boost || ""} onChange={v => setWaSettings({ ...s, meta_tts_language_boost: v })} placeholder="" />
        </div>
        <label style={LABEL}>{t("Meta TTS Prompt")}</label>
        <textarea
          value={s.meta_tts_prompt || ""}
          onChange={e => setWaSettings({ ...s, meta_tts_prompt: e.target.value })}
          style={{ width: "100%", minHeight: 180, padding: 14, borderRadius: 10, border: "1px solid #e0e0e0", fontSize: 13, outline: "none", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", resize: "vertical", boxSizing: "border-box" }}
        />
        <div style={{ fontSize: 11, color: "#aaa", marginTop: 6 }}>{(s.meta_tts_prompt || "").length} {t("字符")}</div>
      </div>

      <div style={CARD}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 4 }}>{t("敏感欄位")}</div>
            <div style={HELP}>{t("敏感欄位只可重置；明文不會進入前端 cache。")}</div>
          </div>
          <button
            type="button"
            onClick={loadSecretMasks}
            style={{ padding: "8px 14px", background: "#fff8e1", color: "#8a6900", border: "1px solid #f4dca4", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}
          >
            {t("解鎖遮罩")}
          </button>
        </div>
        <div style={{ display: "grid", gap: 10 }}>
          {META_SECRET_FIELDS.map(renderSecretField)}
        </div>
      </div>
    </div>
  );
}
