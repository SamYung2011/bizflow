import React, { useState, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabaseClient.js'
import { useAppContext } from '../context/AppContext.jsx'
import { useT } from '../i18n.jsx'
import { Icon } from '../components/Icon.jsx'
import { Input, Select } from '../components/Inputs.jsx'
import InvoiceEditModal from '../components/InvoiceEditModal.jsx'
import { suggestEmail } from '../lib/emailSuggest.js'
import { CAR_BRANDS, PRODUCTS_LIST, REFERRAL_SOURCES } from '../lib/constants.js'
import { fmtInvNum } from '../lib/invoiceHelpers.js'

// 多值字段拆分（與 App.jsx 內定義同步）
const splitMulti = v => String(v || "").split(/\n+/).map(s => s.trim()).filter(Boolean);

export function MergeHistoryModal({
  mergeHistoryOpen, setMergeHistoryOpen,
  openRollback,
  handleUpgradePhysical,
}) {
  const { t } = useT()
  const { customers } = useAppContext()
  if (!mergeHistoryOpen) return null
  const vc = mergeHistoryOpen;
  const allCids = vc.allCids || vc.groupCids || [vc.id];
  const physMerged = new Set(vc.mergedChildCids || []);
  const rows = allCids.map(cid => {
    const real = customers.find(c => c.id === cid);
    if (!real) return null;
    return { real, isPhysicalChild: physMerged.has(cid) };
  }).filter(Boolean);
  return (
    <div onClick={() => setMergeHistoryOpen(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: 28, width: 720, maxWidth: "100%", maxHeight: "90vh", overflowY: "auto", boxShadow: "0 10px 40px rgba(0,0,0,0.25)" }}>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>{t("合併記錄")}</div>
        <div style={{ fontSize: 12, color: "#888", marginBottom: 16 }}>
          {t("此客戶由")} {rows.length} {t("條原始記錄組成（虛擬：字段命中 3+ 自動合併；物理：除名字外完全相等已合併到主記錄）")}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {rows.map(({ real, isPhysicalChild }) => {
            const isPrimary = real.id === vc.id;
            return (
            <div key={real.id} style={{ border: "1px solid #eee", borderRadius: 10, padding: "12px 14px", background: isPhysicalChild ? "#fff9ec" : "#fafbff" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {!isPrimary && (
                    <button
                      onClick={() => openRollback(vc, real.id)}
                      title={t("回退：從合併組分離、改合併到其他客戶、或恢復字段值")}
                      style={{ fontSize: 12, background: "#fff0f0", color: "#d14343", border: "1px solid #ffcccc", borderRadius: 6, padding: "5px 10px", cursor: "pointer", fontWeight: 600 }}
                    >{t("回退")}</button>
                  )}
                  <span style={{ fontWeight: 700, fontSize: 14 }}>{real.name || t("(無名)")}</span>
                  {isPrimary && <span style={{ fontSize: 10, color: "#2b4eb5", background: "#e0e8ff", borderRadius: 4, padding: "2px 6px", fontWeight: 700 }}>{t("主記錄")}</span>}
                  {isPhysicalChild && <span style={{ fontSize: 10, color: "#8a6900", background: "#fde8b0", borderRadius: 4, padding: "2px 6px", fontWeight: 700 }}>{t("物理合併")}</span>}
                </div>
              </div>
              <div style={{ fontSize: 12, color: "#666", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
                <div>📱 {t("香港")}：{real.phone || "—"}</div>
                <div>📧 {real.email || "—"}</div>
                {real.phone_mainland && <div>📱 {t("內地")}：{real.phone_mainland}</div>}
                {real.address && <div>📍 {real.address}</div>}
                {real.car_make && <div>🚗 {real.car_make} {real.car_model || ""}</div>}
                <div style={{ color: "#aaa", fontSize: 11 }}>id: {real.id.slice(0, 8)}…</div>
              </div>
            </div>
            );
          })}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 18, gap: 10 }}>
          {(() => {
            const upgradeable = rows.filter(r => !r.isPhysicalChild && r.real.id !== vc.id).length;
            if (upgradeable === 0) return <span />;
            return (
              <button
                onClick={() => handleUpgradePhysical(vc)}
                title={t("把 rule 1 虛擬合併的成員真正綁定到主記錄，之後刪除字段才真生效")}
                style={{ background: "#fff6e5", color: "#b87500", border: "1px solid #ffd88a", borderRadius: 8, padding: "10px 16px", fontWeight: 700, cursor: "pointer", fontSize: 13 }}
              >{t("升級為物理合併")} ({upgradeable})</button>
            );
          })()}
          <button onClick={() => setMergeHistoryOpen(null)} style={{ background: "#f5f5f5", border: "none", borderRadius: 8, padding: "10px 18px", fontWeight: 600, cursor: "pointer" }}>{t("關閉")}</button>
        </div>
      </div>
    </div>
  );
}

export function RollbackModal({
  rollbackOpen, setRollbackOpen,
  rollbackMergeToQuery, setRollbackMergeToQuery,
  rollbackMergeTo, setRollbackMergeTo,
  rollbackMergeToOpen, setRollbackMergeToOpen,
  rollbackAffected, setRollbackAffected,
  rollbackTarget, setRollbackTarget,
  rollbackFields, setRollbackFields,
  rollbackBusy,
  handleRollback,
}) {
  const { t } = useT()
  const { customers, customerGroups } = useAppContext()
  if (!rollbackOpen) return null
  const { vc, clickedCid } = rollbackOpen;
  const primaryCid = vc.id;
  const allRelated = [
    ...((vc.groupCids || []).filter(id => id !== primaryCid)),
    ...((vc.mergedChildCids) || []),
  ];
  const records = allRelated.map(cid => customers.find(c => c.id === cid)).filter(Boolean);
  const clickedRec = customers.find(c => c.id === clickedCid);
  const primaryRec = customers.find(c => c.id === primaryCid);
  const splitMulti2 = v => String(v || "").split(/\n+/).map(s => s.trim()).filter(Boolean);
  // 收集合并组所有字段值供字段恢复 picker 用
  const allIds = [...(vc.groupCids || []), ...(vc.mergedChildCids || [])];
  const gather = (dbKey) => {
    const s = new Set();
    for (const id of allIds) {
      const r = customers.find(c => c.id === id);
      if (!r) continue;
      splitMulti2(r[dbKey]).forEach(v => s.add(v));
    }
    return Array.from(s);
  };
  const FIELD_DEFS = [
    { dbKey: "phone", label: t("香港電話") },
    { dbKey: "phone_mainland", label: t("內地電話") },
    { dbKey: "email", label: t("郵箱") },
    { dbKey: "address", label: t("地址") },
    { dbKey: "car_make", label: t("車品牌") },
    { dbKey: "car_model", label: t("車型") },
  ];
  // 搜合併目標：排除自己合併組成員（已在組內，合併無意義）
  const excludeForTarget = new Set(allIds);
  const q = rollbackMergeToQuery.toLowerCase().trim();
  const mergeToCandidates = customerGroups.virtualCustomers.filter(v => {
    if (excludeForTarget.has(v.id)) return false;
    if (!q) return true;
    const hit = (arr) => (arr || []).some(x => String(x).toLowerCase().includes(q));
    return hit(v.allNames) || hit(v.allPhones) || hit(v.allEmails);
  }).slice(0, 15);
  const toggleAffected = (cid) => setRollbackAffected(prev => {
    const next = new Set(prev);
    if (next.has(cid)) next.delete(cid); else next.add(cid);
    return next;
  });
  return (
    <div onClick={() => !rollbackBusy && setRollbackOpen(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 2100, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: 28, width: 720, maxWidth: "100%", maxHeight: "90vh", overflowY: "auto", boxShadow: "0 10px 40px rgba(0,0,0,0.25)" }}>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>{t("回退合併")}</div>
        <div style={{ fontSize: 12, color: "#888", marginBottom: 18 }}>
          {t("主記錄")}：<b>{primaryRec?.name || t("(無名)")}</b>（id: {primaryCid.slice(0,8)}…）<br/>
          {t("點擊的記錄")}：<b>{clickedRec?.name || t("(無名)")}</b>（id: {clickedCid.slice(0,8)}…）
        </div>

        {/* 影響範圍 */}
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#333", marginBottom: 8 }}>{t("1. 影響範圍（勾選要一併回退的記錄）")}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 180, overflowY: "auto", border: "1px solid #eee", borderRadius: 8, padding: 10 }}>
            {records.map(r => {
              const checked = rollbackAffected.has(r.id);
              const isPhys = Boolean(r.parent_id);
              return (
                <label key={r.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", border: "1px solid " + (checked ? "#6382ff" : "#eee"), background: checked ? "#f0f4ff" : "#fff", borderRadius: 6, cursor: "pointer", fontSize: 12 }}>
                  <input type="checkbox" checked={checked} onChange={() => toggleAffected(r.id)} />
                  <span style={{ fontWeight: 600 }}>{r.name || t("(無名)")}</span>
                  <span style={{ fontSize: 10, color: isPhys ? "#8a6900" : "#2b4eb5", background: isPhys ? "#fde8b0" : "#e0e8ff", borderRadius: 4, padding: "1px 6px", fontWeight: 700 }}>{isPhys ? t("物理子") : t("rule 1 獨立")}</span>
                  <span style={{ color: "#888" }}>{r.phone || "—"} · {r.email || "—"}</span>
                  <span style={{ color: "#aaa", marginLeft: "auto" }}>id: {r.id.slice(0,8)}…</span>
                </label>
              );
            })}
          </div>
        </div>

        {/* 目標 */}
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#333", marginBottom: 8 }}>{t("2. 回退後的目標")}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", border: "1px solid " + (rollbackTarget === "independent" ? "#6382ff" : "#e0e0e0"), background: rollbackTarget === "independent" ? "#f0f4ff" : "#fff", borderRadius: 8, cursor: "pointer" }}>
              <input type="radio" checked={rollbackTarget === "independent"} onChange={() => setRollbackTarget("independent")} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{t("變為獨立客戶")}</div>
                <div style={{ fontSize: 11, color: "#888" }}>{t("物理子記錄會清 parent_id；rule 1 獨立會加入 merge_exclude 不再自動合併回主記錄")}</div>
              </div>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", border: "1px solid " + (rollbackTarget === "mergeTo" ? "#6382ff" : "#e0e0e0"), background: rollbackTarget === "mergeTo" ? "#f0f4ff" : "#fff", borderRadius: 8, cursor: "pointer" }}>
              <input type="radio" checked={rollbackTarget === "mergeTo"} onChange={() => setRollbackTarget("mergeTo")} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{t("合併到其他客戶")}</div>
                <div style={{ fontSize: 11, color: "#888", marginBottom: rollbackTarget === "mergeTo" ? 6 : 0 }}>{t("所選記錄 UPDATE parent_id = 目標客戶")}</div>
                {rollbackTarget === "mergeTo" && (
                  <div style={{ position: "relative" }}>
                    <input
                      value={rollbackMergeToQuery}
                      onChange={e => { setRollbackMergeToQuery(e.target.value); setRollbackMergeToOpen(true); if (rollbackMergeTo) setRollbackMergeTo(""); }}
                      onFocus={() => setRollbackMergeToOpen(true)}
                      onBlur={() => setTimeout(() => setRollbackMergeToOpen(false), 150)}
                      placeholder={t("輸入客戶姓名 / 電話 / 郵箱...")}
                      style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid " + (rollbackMergeTo ? "#6382ff" : "#e0e0e0"), fontSize: 13, outline: "none", boxSizing: "border-box" }}
                    />
                    {rollbackMergeToOpen && rollbackMergeToQuery && (
                      <div style={{ position: "absolute", top: "calc(100% + 2px)", left: 0, right: 0, maxHeight: 200, overflowY: "auto", background: "#fff", border: "1px solid #e0e0e0", borderRadius: 8, boxShadow: "0 4px 12px rgba(0,0,0,0.08)", zIndex: 10 }}>
                        {mergeToCandidates.length === 0 ? (
                          <div style={{ padding: "8px 12px", fontSize: 12, color: "#999" }}>{t("沒找到")}</div>
                        ) : mergeToCandidates.map(v => (
                          <div key={v.id} onMouseDown={() => { setRollbackMergeTo(v.id); setRollbackMergeToQuery(`${v.name || t("(無名)")} · ${v.phone || "—"}`); setRollbackMergeToOpen(false); }}
                            style={{ padding: "7px 12px", fontSize: 12, cursor: "pointer", borderBottom: "1px solid #f5f5f5" }}
                            onMouseEnter={e => e.currentTarget.style.background = "#f8f9ff"}
                            onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                            <div style={{ fontWeight: 600 }}>{v.name || t("(無名)")}</div>
                            <div style={{ color: "#888", fontSize: 11 }}>{v.phone || "—"} · {v.email || "—"}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </label>
          </div>
        </div>

        {/* 字段恢復 */}
        {rollbackAffected.has(clickedCid) && clickedRec && (
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#333", marginBottom: 4 }}>{t("3. 字段恢復（僅對點擊的記錄")} {clickedRec.name || t("(無名)")}）</div>
            <div style={{ fontSize: 11, color: "#888", marginBottom: 10 }}>{t("可選：從合併組其他成員的字段池裡挑值覆蓋。選「不修改」保留當前值。")}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {FIELD_DEFS.map(({ dbKey, label }) => {
                const vals = gather(dbKey);
                const cur = clickedRec[dbKey];
                return (
                  <div key={dbKey} style={{ display: "grid", gridTemplateColumns: "100px 1fr", alignItems: "center", gap: 8 }}>
                    <div style={{ fontSize: 12, color: "#666", fontWeight: 600 }}>{label}</div>
                    <select
                      value={rollbackFields[dbKey] ?? ""}
                      onChange={e => setRollbackFields(prev => ({ ...prev, [dbKey]: e.target.value }))}
                      style={{ padding: "6px 8px", border: "1px solid #e0e0e0", borderRadius: 6, fontSize: 12, background: "#fff" }}
                    >
                      <option value="">-- {t("不修改（當前：")}{cur ? String(cur).slice(0, 30) + (String(cur).length > 30 ? "…" : "") : t("空")}）--</option>
                      {vals.map(v => <option key={v} value={v}>{v.slice(0, 60)}{v.length > 60 ? "…" : ""}</option>)}
                      <option value="__clear__">-- {t("清空")} --</option>
                    </select>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 按鈕 */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button onClick={() => !rollbackBusy && setRollbackOpen(null)} disabled={rollbackBusy} style={{ background: "#f5f5f5", border: "none", borderRadius: 8, padding: "10px 18px", fontWeight: 600, cursor: rollbackBusy ? "not-allowed" : "pointer" }}>{t("取消")}</button>
          <button onClick={handleRollback} disabled={rollbackBusy} style={{ background: rollbackBusy ? "#ccc" : "#d14343", color: "#fff", border: "none", borderRadius: 8, padding: "10px 18px", fontWeight: 700, cursor: rollbackBusy ? "not-allowed" : "pointer" }}>{rollbackBusy ? t("執行中...") : t("確認回退")}</button>
        </div>
      </div>
    </div>
  );
}

export function MergeCandidatesModal({
  mergeCandidatesOpen, setMergeCandidatesOpen,
  mergeAllBusy,
  handleMergeAllPhysical,
  handleUpgradePhysical,
  setSelectedCustomer,
}) {
  const { t } = useT()
  const { customerGroups } = useAppContext()
  if (!mergeCandidatesOpen) return null
  const candidates = customerGroups.virtualCustomers
    .filter(v => (v.groupCids || []).length > 1)
    .sort((a, b) => (b.groupCids?.length || 0) - (a.groupCids?.length || 0));
  return (
    <div onClick={() => setMergeCandidatesOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: 28, width: 760, maxWidth: "100%", maxHeight: "90vh", overflowY: "auto", boxShadow: "0 10px 40px rgba(0,0,0,0.25)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, gap: 12 }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{t("疑似重複客戶檢測")}</div>
          {candidates.length > 0 && (
            <button
              onClick={() => handleMergeAllPhysical(candidates)}
              disabled={mergeAllBusy}
              style={{ background: mergeAllBusy ? "#a8b8e8" : "#6382ff", color: "#fff", border: "none", borderRadius: 10, padding: "10px 18px", cursor: mergeAllBusy ? "not-allowed" : "pointer", fontWeight: 700, fontSize: 13, whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 6 }}
            >
              {mergeAllBusy ? t("合併中…") : `⚡ ${t("一鍵合併全部")} ${candidates.length} ${t("組")}`}
            </button>
          )}
        </div>
        <div style={{ fontSize: 12, color: "#888", marginBottom: 16 }}>
          {t("共")} {candidates.length} {t("組虛擬合併（資料命中 3+ 字段自動合併）。點「物理合併」把成員綁定到主記錄，之後刪字段才真生效。")}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {candidates.length === 0 && (
            <div style={{ textAlign: "center", color: "#aaa", padding: 30, fontSize: 13 }}>{t("沒有疑似重複的客戶")}</div>
          )}
          {candidates.map(vc => {
            const siblingCount = (vc.groupCids || []).filter(id => id !== vc.id).length;
            const preview = [vc.phone, vc.email, splitMulti(vc.car_make)[0]].filter(Boolean).join(" · ");
            return (
              <div key={vc.id} style={{ border: "1px solid #eee", borderRadius: 10, padding: "12px 14px", background: "#fafbff", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2, display: "flex", alignItems: "center", gap: 6 }}>
                    {vc.name || t("(無名)")}
                    <span style={{ fontSize: 10, color: "#6382ff", background: "#eef2ff", borderRadius: 20, padding: "1px 8px", fontWeight: 700 }}>{t("合併組")} {vc.groupCids.length} {t("條")}</span>
                  </div>
                  <div style={{ fontSize: 12, color: "#666", marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{preview || "—"}</div>
                  {vc.allNames && vc.allNames.length > 1 && (
                    <div style={{ fontSize: 11, color: "#888" }}>{t("別名")}：{vc.allNames.filter(n => n !== vc.name).join(" / ")}</div>
                  )}
                </div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <button
                    onClick={() => { setMergeCandidatesOpen(false); setSelectedCustomer(vc); }}
                    style={{ fontSize: 12, background: "#f5f5f5", color: "#666", border: "none", borderRadius: 6, padding: "7px 12px", cursor: "pointer", fontWeight: 600 }}
                  >{t("查看")}</button>
                  <button
                    onClick={() => handleUpgradePhysical(vc)}
                    style={{ fontSize: 12, background: "#6382ff", color: "#fff", border: "none", borderRadius: 6, padding: "7px 12px", cursor: "pointer", fontWeight: 700, whiteSpace: "nowrap" }}
                  >{t("物理合併")} {siblingCount}</button>
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}>
          <button onClick={() => setMergeCandidatesOpen(false)} style={{ background: "#f5f5f5", border: "none", borderRadius: 8, padding: "10px 18px", fontWeight: 600, cursor: "pointer" }}>{t("關閉")}</button>
        </div>
      </div>
    </div>
  );
}

export function EditCustomerModal({
  editingCustomer, setEditingCustomer,
  selectedCustomer,
  editCustForm, setEditCustForm,
  editCustSaving,
  editCustCid,
  handleSaveCustomerEdit,
}) {
  const { t } = useT()
  if (!editingCustomer) return null
  const groupCids = (selectedCustomer?.groupCids && selectedCustomer.groupCids.length > 1) ? selectedCustomer.groupCids : null;
  const inp = (label, key) => (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "#666", fontWeight: 600 }}>
      {label}
      <input
        type="text"
        value={editCustForm[key]}
        onChange={e => setEditCustForm(f => ({ ...f, [key]: e.target.value }))}
        style={{ padding: "8px 10px", border: "1px solid #e0e0e0", borderRadius: 8, fontSize: 14, color: "#111" }}
      />
    </label>
  );
  // 多值字段渲染：每项独立 input + × 删除 + "+ 新增" 按钮
  const multiFld = (label, key, placeholder, addText, suggest) => {
    const arr = editCustForm[key] || [""];
    const updateAt = (idx, val) => setEditCustForm(f => {
      const next = [...(f[key] || [""])];
      next[idx] = val;
      return { ...f, [key]: next };
    });
    const removeAt = idx => setEditCustForm(f => {
      const next = (f[key] || []).filter((_, i) => i !== idx);
      return { ...f, [key]: next.length > 0 ? next : [""] };
    });
    const addNew = () => setEditCustForm(f => ({ ...f, [key]: [...(f[key] || []), ""] }));
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12, color: "#666", fontWeight: 600 }}>
        <div>{label}</div>
        {arr.map((v, idx) => {
          const sg = (suggest && v) ? suggest(v) : null;
          return (
            <div key={idx} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  type="text"
                  value={v}
                  placeholder={placeholder}
                  onChange={e => updateAt(idx, e.target.value)}
                  style={{ flex: 1, padding: "8px 10px", border: "1px solid #e0e0e0", borderRadius: 8, fontSize: 14, color: "#111" }}
                />
                {arr.length > 1 && (
                  <button type="button" onClick={() => removeAt(idx)} title={t("刪除")} style={{ width: 34, background: "#fff0f0", color: "#d14343", border: "1px solid #ffcccc", borderRadius: 8, cursor: "pointer", fontWeight: 700 }}>×</button>
                )}
              </div>
              {sg && (
                <div style={{ padding: "5px 10px", background: "#fef3c7", color: "#92400e", borderRadius: 6, fontSize: 11, display: "flex", alignItems: "center", gap: 6 }}>
                  <span>💡 {t("是不是")} <b>{sg}</b>？</span>
                  <button type="button" onClick={() => updateAt(idx, sg)} style={{ marginLeft: "auto", background: "#f59e0b", color: "#fff", border: "none", borderRadius: 5, padding: "2px 8px", fontSize: 10, fontWeight: 700, cursor: "pointer" }}>{t("修正")}</button>
                </div>
              )}
            </div>
          );
        })}
        <button type="button" onClick={addNew} style={{ alignSelf: "flex-start", background: "none", color: "#6382ff", border: "1px dashed #6382ff", borderRadius: 8, padding: "5px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>+ {addText}</button>
      </div>
    );
  };
  return (
    <div onClick={() => !editCustSaving && setEditingCustomer(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: 28, width: 620, maxWidth: "100%", maxHeight: "90vh", overflowY: "auto", boxShadow: "0 10px 40px rgba(0,0,0,0.2)" }}>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>{t("編輯客戶資料")}</div>
        <div style={{ fontSize: 12, color: "#888", marginBottom: 16 }}>id: {editCustCid}</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
          {inp(t("姓名 Name"), "name")}
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "#666", fontWeight: 600 }}>
            {t("類型 Type")}
            <select value={editCustForm.type} onChange={e => setEditCustForm(f => ({ ...f, type: e.target.value }))} style={{ padding: "8px 10px", border: "1px solid #e0e0e0", borderRadius: 8, fontSize: 14, color: "#111", background: "#fff" }}>
              <option value="Regular">Regular</option>
              <option value="Lead">Lead</option>
            </select>
          </label>
        </div>
        <div style={{ marginBottom: 14 }}>
          {multiFld(t("別名 Aliases"), "aliases", t("例：公司別名或其他稱呼"), t("新增別名"))}
        </div>
        <div style={{ marginBottom: 14 }}>
          {inp(t("推薦人 Referral"), "referral")}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
          {multiFld(t("香港電話 Phone"), "phones", t("例：9123 4567"), t("新增香港電話"))}
          {multiFld(t("內地電話 Phone (CN)"), "phoneMainlands", t("例：138 0013 8000"), t("新增內地電話"))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
          {multiFld(t("郵箱 Email"), "emails", t("例：user@example.com"), t("新增郵箱"), suggestEmail)}
          {multiFld(t("車品牌 Car Make"), "carMakes", t("例：Tesla"), t("新增車品牌"))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
          {multiFld(t("車型 Car Model"), "carModels", t("例：Model 3"), t("新增車型"))}
          <div />
        </div>
        <div style={{ marginBottom: 18 }}>
          {multiFld(t("地址 Address"), "addresses", t("請輸入完整地址"), t("新增地址"))}
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button disabled={editCustSaving} onClick={() => setEditingCustomer(null)} style={{ background: "#f5f5f5", border: "none", borderRadius: 8, padding: "10px 18px", fontWeight: 600, cursor: editCustSaving ? "not-allowed" : "pointer" }}>{t("取消")}</button>
          <button disabled={editCustSaving} onClick={handleSaveCustomerEdit} style={{ background: editCustSaving ? "#ccc" : "#6382ff", color: "#fff", border: "none", borderRadius: 8, padding: "10px 18px", fontWeight: 700, cursor: editCustSaving ? "not-allowed" : "pointer" }}>
            {editCustSaving ? t("保存中…") : t("保存")}
          </button>
        </div>
      </div>
    </div>
  );
}

export function AddCustomerModal({
  showAddCustomer, setShowAddCustomer,
  newCustomer, setNewCustomer,
  saving,
  handleSaveCustomer,
}) {
  const { t } = useT()
  if (!showAddCustomer) return null
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
      <div style={{ background: "#fff", borderRadius: 20, padding: 32, width: 580, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>{t("新增客戶")}</h2>
          <button onClick={() => setShowAddCustomer(false)} style={{ background: "#f5f5f5", border: "none", borderRadius: 8, padding: "6px 10px", cursor: "pointer" }}><Icon name="x" size={16} /></button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
          <Input label={t("中文名 / Name *")} value={newCustomer.name} onChange={v => setNewCustomer({...newCustomer, name: v})} placeholder={t("客戶名稱")} />
          <Input label="Email" value={newCustomer.email} onChange={v => setNewCustomer({...newCustomer, email: v})} placeholder="email@example.com" suggest={suggestEmail} />
          <Input label={t("香港電話")} value={newCustomer.phone} onChange={v => setNewCustomer({...newCustomer, phone: v})} placeholder="+852" />
          <Input label={t("內地電話")} value={newCustomer.phone_mainland} onChange={v => setNewCustomer({...newCustomer, phone_mainland: v})} placeholder="+86" />
          <Select label={t("汽車品牌 Car Brand")} value={newCustomer.car_make} onChange={v => setNewCustomer({...newCustomer, car_make: v})} options={CAR_BRANDS} />
          <Input label={t("型號 Car Model")} value={newCustomer.car_model} onChange={v => setNewCustomer({...newCustomer, car_model: v})} placeholder="e.g. Model 3, Han EV" />
          <Select label={t("客戶狀態")} value={newCustomer.type} onChange={v => setNewCustomer({...newCustomer, type: v})} options={["Lead","Regular","VIP"]} />
          <Select label={t("客戶來源")} value={newCustomer.referral} onChange={v => setNewCustomer({...newCustomer, referral: v})} options={REFERRAL_SOURCES} />
        </div>
        <Input label={t("地址")} value={newCustomer.address} onChange={v => setNewCustomer({...newCustomer, address: v})} placeholder={t("完整地址")} />
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 13, fontWeight: 700, color: "#555", display: "block", marginBottom: 8 }}>{t("有興趣產品 Interested Products")}</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {PRODUCTS_LIST.map(p => (
              <label key={p} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", background: newCustomer.interest_products.includes(p) ? "#e8edff" : "#f5f5f5", borderRadius: 20, cursor: "pointer", fontSize: 13, border: newCustomer.interest_products.includes(p) ? "1px solid #6382ff" : "1px solid transparent", color: newCustomer.interest_products.includes(p) ? "#6382ff" : "#555", fontWeight: newCustomer.interest_products.includes(p) ? 700 : 400 }}>
                <input type="checkbox" checked={newCustomer.interest_products.includes(p)} onChange={e => {
                  const list = e.target.checked ? [...newCustomer.interest_products, p] : newCustomer.interest_products.filter(x => x !== p);
                  setNewCustomer({...newCustomer, interest_products: list});
                }} style={{ display: "none" }} />{p}
              </label>
            ))}
          </div>
        </div>
        <Input label={t("備註")} value={newCustomer.notes} onChange={v => setNewCustomer({...newCustomer, notes: v})} placeholder={t("其他備註...")} />
        <button onClick={handleSaveCustomer} disabled={!newCustomer.name || saving} style={{ width: "100%", padding: 14, background: newCustomer.name ? "#6382ff" : "#e0e0e0", color: "#fff", border: "none", borderRadius: 12, fontSize: 16, fontWeight: 800, cursor: newCustomer.name ? "pointer" : "not-allowed" }}>
          {saving ? t("儲存中...") : t("儲存客戶")}
        </button>
      </div>
    </div>
  );
}

export function CustomersListView({
  setSelectedCustomer,
  search, setSearch,
  setShowAddCustomer,
  setMergeCandidatesOpen,
  Badge,
}) {
  const { t } = useT()
  const { invoices, customerGroups } = useAppContext()
  const [visibleCustomers, setVisibleCustomers] = useState(30)
  const [customerSort, setCustomerSort] = useState("created")
  const [customerSortDir, setCustomerSortDir] = useState("desc")
  const [customerTimeRange, setCustomerTimeRange] = useState("all")
  const [customerSourceFilter, setCustomerSourceFilter] = useState("all") // all / shopify / framer / other

  const customerSourceMap = useMemo(() => {
    const inferSource = (inv) => {
      const notes = inv?.notes || "";
      if (notes.includes("__FORMS_BUY__")) return "framer";
      if (notes.includes("__BROADWAY__")) return "other";
      if (inv?.invoice_number && /^\d+$/.test(String(inv.invoice_number))) return "shopify";
      return "other";
    };
    const invoicesByGroup = new Map();
    for (const inv of invoices) {
      if (!inv.customer_id) continue;
      const gid = customerGroups.idToGroup?.get?.(inv.customer_id);
      if (!gid) continue;
      if (!invoicesByGroup.has(gid)) invoicesByGroup.set(gid, []);
      invoicesByGroup.get(gid).push(inv);
    }
    const map = new Map();
    for (const c of customerGroups.virtualCustomers) {
      const list = invoicesByGroup.get(c.id);
      if (!list || list.length === 0) { map.set(c.id, "other"); continue; }
      const earliest = [...list].sort((a, b) => new Date(a.date) - new Date(b.date))[0];
      map.set(c.id, inferSource(earliest));
    }
    return map;
  }, [customerGroups, invoices]);

  const filteredCustomers = useMemo(() => {
    const cutoff = customerTimeRange === "all" ? null : new Date(Date.now() - parseInt(customerTimeRange) * 86400000);
    // lastPurchaseMap 按 group id 聚合（group 內任一 cid 的最近購買）
    const lastPurchaseMap = {};
    if (customerSort === "lastPurchase" || cutoff) {
      for (const inv of invoices) {
        if (!inv.customer_id || !inv.date) continue;
        const gid = customerGroups.idToGroup.get(inv.customer_id);
        if (!gid) continue;
        const prev = lastPurchaseMap[gid];
        if (!prev || new Date(inv.date) > new Date(prev)) {
          lastPurchaseMap[gid] = inv.date;
        }
      }
    }
    const q = search.toLowerCase();
    return customerGroups.virtualCustomers.filter(c => {
      // 至少一個 email 或 phone 有值
      if (c.allEmails.length === 0 && c.allPhones.length === 0) return false;
      if (q) {
        const hit = c.allNames.some(n => n.toLowerCase().includes(q))
          || c.allEmails.some(e => e.toLowerCase().includes(q))
          || c.allPhones.some(p => p.toLowerCase().includes(q))
          || (c.car_make || "").toLowerCase().includes(q)
          || (c.car_model || "").toLowerCase().includes(q);
        if (!hit) return false;
      }
      if (customerSourceFilter !== "all") {
        if (customerSourceMap.get(c.id) !== customerSourceFilter) return false;
      }
      if (!cutoff) return true;
      const dateStr = lastPurchaseMap[c.id];
      return dateStr && new Date(dateStr) >= cutoff;
    }).sort((a, b) => {
      const dir = customerSortDir === "desc" ? 1 : -1;
      const va = customerSort === "lastPurchase" ? lastPurchaseMap[a.id] : a.created_at;
      const vb = customerSort === "lastPurchase" ? lastPurchaseMap[b.id] : b.created_at;
      if (!va && !vb) return 0;
      if (!va) return 1;
      if (!vb) return -1;
      return vb.localeCompare(va) * dir;
    });
  }, [customerGroups, invoices, search, customerSort, customerSortDir, customerTimeRange, customerSourceFilter, customerSourceMap]);

  return (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
              <div>
                <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>{t("客戶")}</h1>
                <p style={{ color: "#888", margin: "4px 0 0", fontSize: 14 }}>
                  {customerTimeRange === "all"
                    ? `${t("共")} ${filteredCustomers.length} ${t("位客戶")}`
                    : `${t("共")} ${filteredCustomers.length} ${t("位客戶")}（${customerTimeRange}${t("天內有購買")}）`}
                </p>
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                {(() => {
                  const candidates = customerGroups.virtualCustomers.filter(v => (v.groupCids || []).length > 1);
                  if (candidates.length === 0) return null;
                  return (
                    <button
                      onClick={() => setMergeCandidatesOpen(true)}
                      title={t("列出所有虛擬合併的客戶組，一鍵升級為物理合併")}
                      style={{ display: "flex", alignItems: "center", gap: 8, background: "#fff6e5", color: "#b87500", border: "1px solid #ffd88a", borderRadius: 10, padding: "10px 16px", cursor: "pointer", fontWeight: 700, fontSize: 14 }}
                    >🔍 {t("疑似重複")} {candidates.length} {t("組")}</button>
                  );
                })()}
                <button onClick={() => setShowAddCustomer(true)} style={{ display: "flex", alignItems: "center", gap: 8, background: "#6382ff", color: "#fff", border: "none", borderRadius: 10, padding: "10px 18px", cursor: "pointer", fontWeight: 700, fontSize: 14 }}>
                  <Icon name="plus" size={16} /> {t("新增客戶")}
                </button>
              </div>
            </div>

            <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #f0f0f0", padding: "10px 14px", marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
              <Icon name="search" size={15} />
              <input placeholder={t("搜尋客戶...")} value={search} onChange={e => { setSearch(e.target.value); setVisibleCustomers(30); }} style={{ border: "none", background: "none", outline: "none", fontSize: 14, width: "100%" }} />
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontSize: 13, color: "#888", marginRight: 4 }}>{t("排序")}：</span>
              {[["created", t("建立時間")], ["lastPurchase", t("最近購買")]].map(([k, label]) => (
                <button key={k} onClick={() => { setCustomerSort(k); setVisibleCustomers(30); }} style={{ padding: "6px 14px", borderRadius: 20, lineHeight: "20px", border: customerSort === k ? "1px solid #6382ff" : "1px solid #e0e0e0", background: customerSort === k ? "#f0f4ff" : "#fff", color: customerSort === k ? "#6382ff" : "#666", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>{label}</button>
              ))}
              <button onClick={() => { setCustomerSortDir(d => d === "desc" ? "asc" : "desc"); setVisibleCustomers(30); }} title={customerSortDir === "desc" ? t("目前降序（新→舊），點擊切換為升序") : t("目前升序（舊→新），點擊切換為降序")} style={{ padding: "6px 14px", borderRadius: 20, lineHeight: "20px", border: "1px solid #6382ff", background: "#6382ff", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                {customerSortDir === "desc" ? t("↓ 降序") : t("↑ 升序")}
              </button>
              <span style={{ fontSize: 13, color: "#888", marginLeft: 12, marginRight: 4 }}>{t("時間")}：</span>
              {[["all", t("全部")], ["7", t("7天")], ["30", t("30天")], ["90", t("90天")]].map(([k, label]) => (
                <button key={k} onClick={() => { setCustomerTimeRange(k); setVisibleCustomers(30); }} style={{ padding: "6px 14px", borderRadius: 20, lineHeight: "20px", border: customerTimeRange === k ? "1px solid #6382ff" : "1px solid #e0e0e0", background: customerTimeRange === k ? "#f0f4ff" : "#fff", color: customerTimeRange === k ? "#6382ff" : "#666", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>{label}</button>
              ))}
              <span style={{ fontSize: 13, color: "#888", marginLeft: 12, marginRight: 4 }}>{t("來源")}：</span>
              {[["all", t("全部")], ["shopify", "Shopify"], ["framer", t("官網表格")], ["other", t("其他")]].map(([k, label]) => (
                <button key={k} onClick={() => { setCustomerSourceFilter(k); setVisibleCustomers(30); }} style={{ padding: "6px 14px", borderRadius: 20, lineHeight: "20px", border: customerSourceFilter === k ? "1px solid #6382ff" : "1px solid #e0e0e0", background: customerSourceFilter === k ? "#f0f4ff" : "#fff", color: customerSourceFilter === k ? "#6382ff" : "#666", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>{label}</button>
              ))}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {filteredCustomers.slice(0, visibleCustomers).map(c => {
                const cids = c.allCids || c.groupCids || [c.id];
                const custInvoices = invoices.filter(i => cids.includes(i.customer_id));
                const total = custInvoices.reduce((s, i) => s + (i.total || 0), 0);
                return (
                      <div key={c.id} onClick={() => setSelectedCustomer(c)} style={{ background: "#fff", borderRadius: 14, padding: "18px 22px", border: "1px solid #f0f0f0", boxShadow: "0 2px 8px rgba(0,0,0,0.03)", display: "flex", alignItems: "center", gap: 18, cursor: "pointer" }}
                        onMouseEnter={e => e.currentTarget.style.borderColor = "#6382ff"}
                        onMouseLeave={e => e.currentTarget.style.borderColor = "#f0f0f0"}>
                        <div style={{ width: 48, height: 48, borderRadius: "50%", background: "linear-gradient(135deg,#6382ff,#a78bfa)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 800, color: "#fff", flexShrink: 0 }}>
                          {(c.name || "?")[0]}
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 3, flexWrap: "wrap" }}>
                            <span style={{ fontSize: 16, fontWeight: 800 }}>{c.name}</span>
                            <Badge status={c.type || "Regular"} />
                            {(() => {
                              const srcKey = customerSourceMap.get(c.id);
                              if (!srcKey || srcKey === "other") return null;
                              const srcInfo = srcKey === "shopify"
                                ? { label: "Shopify", color: "#16a34a", bg: "#dcfce7" }
                                : { label: t("官網表格"), color: "#6382ff", bg: "#eef2ff" };
                              return <span style={{ fontSize: 11, color: srcInfo.color, background: srcInfo.bg, padding: "2px 8px", borderRadius: 6, fontWeight: 700 }}>{srcInfo.label}</span>;
                            })()}
                          </div>
                          <div style={{ fontSize: 13, color: "#666" }}>
                            {c.phone || "—"}
                            {c.car_make && <span style={{ color: "#aaa", marginLeft: 8 }}>🚗 {c.car_make} {c.car_model}</span>}
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: 12, textAlign: "center" }}>
                          <div style={{ padding: "8px 14px", background: "#f0f4ff", borderRadius: 10 }}>
                            <div style={{ fontSize: 16, fontWeight: 800, color: "#6382ff" }}>HKD${total.toLocaleString()}</div>
                            <div style={{ fontSize: 11, color: "#888" }}>{t("累計")}</div>
                          </div>
                          <div style={{ padding: "8px 14px", background: "#fff8f0", borderRadius: 10 }}>
                            <div style={{ fontSize: 16, fontWeight: 800, color: "#f59e0b" }}>{custInvoices.length}</div>
                            <div style={{ fontSize: 11, color: "#888" }}>{t("訂單")}</div>
                          </div>
                        </div>
                      </div>
                );
              })}
              {visibleCustomers < filteredCustomers.length && (
                <button onClick={() => setVisibleCustomers(v => v + 30)} style={{ display: "block", margin: "12px auto", padding: "10px 28px", background: "#f0f4ff", color: "#6382ff", border: "1px solid #e0e8ff", borderRadius: 10, cursor: "pointer", fontWeight: 700, fontSize: 14 }}>
                  {t("載入更多")}（{filteredCustomers.length - visibleCustomers} {t("項待載入")}）
                </button>
              )}
            </div>
          </div>
  );
}

export function CustomersDetailView({
  selectedCustomer, setSelectedCustomer,
  openEditCustomer,
  setManualMergeQuery, setManualMergeOpen,
  handleDeleteCustomer,
  setMergeHistoryOpen,
  handleMarkPaid,
  openPrintChooser,
  Badge,
  formatNotes,
}) {
  const { t } = useT()
  const { invoices, products } = useAppContext()
  // 客戶詳情頁本地的「編輯發票 modal」狀態 —— 零跨 view 通信
  const [editingInvFromCustomer, setEditingInvFromCustomer] = useState(null)
  return (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <button onClick={() => setSelectedCustomer(null)} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", color: "#6382ff", fontWeight: 700, fontSize: 14, padding: 0 }}>
                <Icon name="back" size={16} /> {t("返回客戶列表")}
              </button>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => openEditCustomer(selectedCustomer)} title={t("編輯客戶")} style={{ display: "flex", alignItems: "center", gap: 6, background: "#fff9ec", color: "#d08700", border: "1px solid #f4dca4", borderRadius: 8, padding: "7px 14px", cursor: "pointer", fontWeight: 700, fontSize: 13 }}>
                  ✏️ {t("編輯客戶")}
                </button>
                <button onClick={() => { setManualMergeQuery(""); setManualMergeOpen(true); }} title={t("合併到其他客戶")} style={{ display: "flex", alignItems: "center", gap: 6, background: "#eef2ff", color: "#6382ff", border: "1px solid #c7d2fe", borderRadius: 8, padding: "7px 14px", cursor: "pointer", fontWeight: 700, fontSize: 13 }}>
                  🔗 {t("合併到其他客戶")}
                </button>
                <button onClick={() => handleDeleteCustomer(selectedCustomer)} title={t("刪除客戶")} style={{ display: "flex", alignItems: "center", gap: 6, background: "#fff0f0", color: "#d14343", border: "1px solid #ffcccc", borderRadius: 8, padding: "7px 14px", cursor: "pointer", fontWeight: 700, fontSize: 13 }}>
                  🗑️ {t("刪除客戶")}
                </button>
              </div>
            </div>
            <div style={{ background: "#fff", borderRadius: 16, padding: 28, border: "1px solid #f0f0f0", boxShadow: "0 2px 12px rgba(0,0,0,0.04)", marginBottom: 20 }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 20, marginBottom: 24 }}>
                <div style={{ width: 64, height: 64, borderRadius: "50%", background: "linear-gradient(135deg,#6382ff,#a78bfa)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, fontWeight: 800, color: "#fff", flexShrink: 0 }}>
                  {(selectedCustomer.name || "?")[0]}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 2, flexWrap: "wrap" }}>
                    <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>{selectedCustomer.name}</h2>
                    <Badge status={selectedCustomer.type || "Regular"} />
                    {(() => {
                      const totalCount = (selectedCustomer.allCids || selectedCustomer.groupCids || []).length;
                      if (totalCount <= 1) return null;
                      return (
                        <button
                          onClick={() => setMergeHistoryOpen(selectedCustomer)}
                          style={{ fontSize: 11, color: "#6382ff", background: "#eef2ff", borderRadius: 20, padding: "2px 10px", fontWeight: 700, border: "none", cursor: "pointer" }}
                          title={t("查看合併記錄")}
                        >
                          {t("已合併")} {totalCount} {t("條重複記錄 →")}
                        </button>
                      );
                    })()}
                  </div>
                  {(() => {
                    const aliases = [...new Set((selectedCustomer.allNames || []).filter(n => n && n !== selectedCustomer.name))];
                    if (aliases.length === 0) return null;
                    return (
                      <div style={{ marginBottom: 8 }}>
                        {aliases.map(a => (
                          <div key={a} style={{ fontSize: 22, fontWeight: 800, color: "#111" }}>{a}</div>
                        ))}
                      </div>
                    );
                  })()}
                  {(() => {
                    const emails = (selectedCustomer.allEmails && selectedCustomer.allEmails.length > 0) ? selectedCustomer.allEmails : (selectedCustomer.email ? [selectedCustomer.email] : []);
                    const phones = (selectedCustomer.allPhones && selectedCustomer.allPhones.length > 0) ? selectedCustomer.allPhones : (selectedCustomer.phone ? [selectedCustomer.phone] : []);
                    const pmSrc = (selectedCustomer.allPhoneMainlands && selectedCustomer.allPhoneMainlands.length > 0) ? selectedCustomer.allPhoneMainlands : (selectedCustomer.phone_mainland ? [selectedCustomer.phone_mainland] : []);
                    const phoneMainlands = [...new Set(pmSrc.flatMap(v => splitMulti(v)))];
                    const addrSrc = (selectedCustomer.allAddresses && selectedCustomer.allAddresses.length > 0) ? selectedCustomer.allAddresses : (selectedCustomer.address ? [selectedCustomer.address] : []);
                    const addresses = [...new Set(addrSrc.flatMap(a => splitMulti(a)))];
                    const makes = splitMulti(selectedCustomer.car_make);
                    const models = splitMulti(selectedCustomer.car_model);
                    const carN = Math.max(makes.length, models.length);
                    const cars = [];
                    for (let i = 0; i < carN; i++) {
                      const mk = makes[i] || "";
                      const md = models[i] || "";
                      if (mk || md) cars.push(`${mk} ${md}`.trim());
                    }
                    const blk = (arr, render) => arr.length === 0 ? null : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        {arr.map((v, i) => <div key={i}>{render(v)}</div>)}
                      </div>
                    );
                    return (
                      <>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, fontSize: 14 }}>
                          {blk(emails, v => <>📧 {v}</>)}
                          {blk(phones, v => <>📱 {t("香港")}：{v}</>)}
                          {blk(phoneMainlands, v => <>📱 {t("內地")}：{v}</>)}
                          {blk(cars, v => <>🚗 {v}</>)}
                          {selectedCustomer.referral && <div>🔗 {t("來源")}：{selectedCustomer.referral}</div>}
                        </div>
                        {addresses.length > 0 && (
                          <div style={{ marginTop: 10, fontSize: 14, display: "flex", flexDirection: "column", gap: 4 }}>
                            {addresses.map((a, i) => <div key={i}>📍 {addresses.length > 1 ? `${t("地址")} ${i + 1}：` : ""}{a}</div>)}
                          </div>
                        )}
                      </>
                    );
                  })()}
                  {selectedCustomer.interest_products?.length > 0 && (
                    <div style={{ marginTop: 10 }}>
                      <span style={{ fontSize: 13, color: "#888" }}>{t("感興趣產品")}：</span>
                      {selectedCustomer.interest_products.map(p => (
                        <span key={p} style={{ background: "#f0f4ff", color: "#6382ff", borderRadius: 20, padding: "3px 10px", fontSize: 12, fontWeight: 600, marginRight: 6 }}>{p}</span>
                      ))}
                    </div>
                  )}
                  {selectedCustomer.notes && <div style={{ marginTop: 10, fontSize: 13, color: "#888", background: "#f9f9f9", borderRadius: 8, padding: "8px 12px" }}>📝 {selectedCustomer.notes}</div>}
                </div>
              </div>
            </div>

            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>{t("購買記錄")}</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {(() => {
                const scCids = selectedCustomer.allCids || selectedCustomer.groupCids || [selectedCustomer.id];
                const myInvoices = invoices.filter(i => scCids.includes(i.customer_id)).slice().sort((a, b) => {
                  const da = a.date || "", db = b.date || "";
                  if (da !== db) return db.localeCompare(da);
                  return String(b.created_at || "").localeCompare(String(a.created_at || ""));
                });
                if (myInvoices.length === 0) return (<div style={{ background: "#fff", borderRadius: 14, padding: 24, textAlign: "center", color: "#aaa", border: "1px solid #f0f0f0" }}>{t("暫無購買記錄")}</div>);
                return myInvoices.map(inv => (
                <div key={inv.id} style={{ background: "#fff", borderRadius: 14, padding: "18px 22px", border: "1px solid #f0f0f0", boxShadow: "0 2px 8px rgba(0,0,0,0.03)", display: "flex", alignItems: "center", gap: 16 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 800, fontSize: 15 }}>{fmtInvNum(inv)}</div>
                    <div style={{ fontSize: 13, color: "#888", marginTop: 3 }}>{inv.date || t("日期未知")} · {formatNotes(inv.notes)}</div>
                    {Array.isArray(inv.items) && inv.items.map((item, i) => (
                      <div key={i} style={{ fontSize: 12, color: "#666", marginTop: 2 }}>{item.name} ×{item.qty} — HKD${item.price}</div>
                    ))}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                    {(inv.status || "").trim().toLowerCase() !== "paid" && (
                      <button onClick={() => handleMarkPaid(inv)} title={t("標記已付款")} style={{ fontSize: 12, background: "#e8f5e9", color: "#22c55e", border: "1px solid #c8e6c9", borderRadius: 8, padding: "7px 10px", cursor: "pointer", fontWeight: 700, display: "flex", alignItems: "center", gap: 5 }}>
                        ✓ {t("標記已付款")}
                      </button>
                    )}
                    <div style={{ fontSize: 18, fontWeight: 800 }}>HKD${inv.total}</div>
                    <Badge status={inv.status} />
                    <button onClick={() => setEditingInvFromCustomer(inv)} title={t("編輯發票")} style={{ fontSize: 12, background: "#fff8e1", color: "#f59e0b", border: "none", borderRadius: 8, padding: "7px 10px", cursor: "pointer", fontWeight: 700 }}>
                      ✏️
                    </button>
                    <button onClick={() => openPrintChooser(inv, selectedCustomer, inv.items || [], products)} style={{ fontSize: 12, background: "#f0f4ff", color: "#6382ff", border: "none", borderRadius: 8, padding: "7px 12px", cursor: "pointer", fontWeight: 700, display: "flex", alignItems: "center", gap: 5 }}>
                      <Icon name="print" size={13} /> Print
                    </button>
                  </div>
                </div>
              ));
              })()}
            </div>

            {/* 編輯發票 modal —— view 自管 state，零跨 view 通信 */}
            <InvoiceEditModal
              invoice={editingInvFromCustomer}
              onClose={() => setEditingInvFromCustomer(null)}
            />
          </div>
  );
}
