import React, { useState, useEffect, useMemo, useRef } from "react";
import { useT } from "../i18n.jsx";
import { toastError } from "../lib/toast.js";

const CATEGORIES = ["餐飲", "交通", "辦公", "物料", "通訊", "其他"];
const CURRENCIES = ["RMB", "HKD", "USD"];
const CURRENCY_SYMBOL = { RMB: "¥", HKD: "HK$", USD: "US$" };

const STATUS_COLORS = {
  pending: { bg: "#fff8e1", color: "#f59e0b", border: "#ffe082" },
  approved: { bg: "#e8f5e9", color: "#22c55e", border: "#a5d6a7" },
  rejected: { bg: "#ffebee", color: "#ef4444", border: "#ffcdd2" },
};

function fmtDate(d) {
  if (!d) return "";
  try {
    return new Date(d).toISOString().slice(0, 10);
  } catch {
    return String(d);
  }
}

function fmtAmount(n) {
  const v = Number(n) || 0;
  return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function StatusChip({ status, t }) {
  const c = STATUS_COLORS[status] || STATUS_COLORS.pending;
  const label = status === "pending" ? t("待審批") : status === "approved" ? t("已通過") : t("已拒絕");
  return (
    <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 999, background: c.bg, color: c.color, border: `1px solid ${c.border}`, fontSize: 12, fontWeight: 600 }}>
      {label}
    </span>
  );
}

function Lightbox({ url, onClose }) {
  if (!url) return null;
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", cursor: "zoom-out" }}>
      <img src={url} alt="" style={{ maxWidth: "92vw", maxHeight: "92vh", objectFit: "contain", borderRadius: 6 }} />
    </div>
  );
}

function ExpenseForm({ t, supabase, currentEmployee, onClose, onSaved, editing }) {
  const [expenseDate, setExpenseDate] = useState(editing?.expense_date || new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState(editing?.amount != null ? String(editing.amount) : "");
  const [currency, setCurrency] = useState(editing?.currency || "RMB");
  const [category, setCategory] = useState(editing?.category || CATEGORIES[0]);
  const [description, setDescription] = useState(editing?.description || "");
  const [receiptUrls, setReceiptUrls] = useState(editing?.receipt_urls || []);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const fileRef = useRef(null);

  async function handleUpload(e) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setUploading(true);
    setErr("");
    try {
      const uploaded = [];
      for (const file of files) {
        const ext = (file.name.split(".").pop() || "bin").toLowerCase();
        const path = `${currentEmployee.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error } = await supabase.storage.from("expense-receipts").upload(path, file, {
          contentType: file.type || "application/octet-stream",
          upsert: false,
        });
        if (error) throw error;
        const { data: pub } = supabase.storage.from("expense-receipts").getPublicUrl(path);
        uploaded.push(pub.publicUrl);
      }
      setReceiptUrls((prev) => [...prev, ...uploaded]);
    } catch (e) {
      setErr(t("上傳失敗：") + (e.message || String(e)));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function removeReceipt(idx) {
    setReceiptUrls((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleSubmit() {
    setErr("");
    if (!expenseDate) return setErr(t("請選擇日期"));
    const num = Number(amount);
    if (!num || num <= 0) return setErr(t("金額必須大於 0"));
    if (!category) return setErr(t("請選擇類別"));

    setSaving(true);
    try {
      const payload = {
        expense_date: expenseDate,
        amount: num,
        currency,
        category,
        description: description.trim() || null,
        receipt_urls: receiptUrls,
      };
      if (editing?.id) {
        const { error } = await supabase.from("expense_reimbursements").update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("expense_reimbursements").insert({ ...payload, employee_id: currentEmployee.id });
        if (error) throw error;
      }
      onSaved();
    } catch (e) {
      setErr(t("保存失敗：") + (e.message || String(e)));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 900, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 14, width: 560, maxWidth: "92vw", maxHeight: "90vh", overflow: "auto", boxShadow: "0 20px 50px rgba(0,0,0,0.2)" }}>
        <div style={{ padding: "18px 22px", borderBottom: "1px solid #eef0f5", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 17, fontWeight: 700 }}>{editing ? t("編輯報銷") : t("新增報銷")}</div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#999" }}>×</button>
        </div>
        <div style={{ padding: 22 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: "#555" }}>
              {t("日期")}
              <input type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)}
                style={{ display: "block", width: "100%", padding: "8px 10px", border: "1px solid #d8dce5", borderRadius: 7, marginTop: 5, fontSize: 14 }} />
            </label>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#555" }}>
              {t("金額")}
              <div style={{ display: "flex", gap: 6, marginTop: 5 }}>
                <select value={currency} onChange={(e) => setCurrency(e.target.value)}
                  style={{ padding: "8px 10px", border: "1px solid #d8dce5", borderRadius: 7, fontSize: 14, background: "#fff", flex: "0 0 90px" }}>
                  {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00"
                  style={{ flex: 1, padding: "8px 10px", border: "1px solid #d8dce5", borderRadius: 7, fontSize: 14, minWidth: 0 }} />
              </div>
            </div>
          </div>
          <label style={{ fontSize: 13, fontWeight: 600, color: "#555", display: "block", marginBottom: 14 }}>
            {t("類別")}
            <select value={category} onChange={(e) => setCategory(e.target.value)}
              style={{ display: "block", width: "100%", padding: "8px 10px", border: "1px solid #d8dce5", borderRadius: 7, marginTop: 5, fontSize: 14, background: "#fff" }}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{t(c)}</option>)}
            </select>
          </label>
          <label style={{ fontSize: 13, fontWeight: 600, color: "#555", display: "block", marginBottom: 14 }}>
            {t("說明")}
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder={t("選填，描述用途")}
              style={{ display: "block", width: "100%", padding: "8px 10px", border: "1px solid #d8dce5", borderRadius: 7, marginTop: 5, fontSize: 14, resize: "vertical", fontFamily: "inherit" }} />
          </label>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#555", marginBottom: 6 }}>{t("收據圖")}</div>
            <input ref={fileRef} type="file" accept="image/*" multiple onChange={handleUpload} disabled={uploading} style={{ fontSize: 13 }} />
            {uploading && <span style={{ marginLeft: 10, fontSize: 12, color: "#999" }}>{t("上傳中…")}</span>}
            {receiptUrls.length > 0 && (
              <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 8 }}>
                {receiptUrls.map((url, i) => (
                  <div key={i} style={{ position: "relative", width: 80, height: 80, border: "1px solid #e5e8ee", borderRadius: 6, overflow: "hidden" }}>
                    <img src={url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    <button onClick={() => removeReceipt(i)} style={{ position: "absolute", top: 2, right: 2, background: "rgba(0,0,0,0.6)", color: "#fff", border: "none", borderRadius: "50%", width: 20, height: 20, cursor: "pointer", fontSize: 12, lineHeight: 1 }}>×</button>
                  </div>
                ))}
              </div>
            )}
          </div>
          {err && <div style={{ background: "#ffebee", color: "#c62828", padding: "8px 12px", borderRadius: 7, fontSize: 13, marginBottom: 14 }}>{err}</div>}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <button onClick={onClose} style={{ padding: "8px 18px", border: "1px solid #d8dce5", background: "#fff", borderRadius: 8, cursor: "pointer", fontSize: 14 }}>{t("取消")}</button>
            <button onClick={handleSubmit} disabled={saving || uploading} style={{ padding: "8px 22px", background: "#6382ff", color: "#fff", border: "none", borderRadius: 8, cursor: saving || uploading ? "not-allowed" : "pointer", fontSize: 14, fontWeight: 600, opacity: saving || uploading ? 0.6 : 1 }}>
              {saving ? t("保存中…") : t("提交")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ExpenseView({ supabase, session, currentEmployee, employees, isAdmin }) {
  const { t } = useT();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingRow, setEditingRow] = useState(null);
  const [lightboxUrl, setLightboxUrl] = useState("");
  const [filter, setFilter] = useState(isAdmin ? "pending" : "mine"); // pending / approved / rejected / paid / mine / all

  const empMap = useMemo(() => {
    const m = new Map();
    (employees || []).forEach((e) => m.set(e.id, e));
    return m;
  }, [employees]);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("expense_reimbursements")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      console.error("[Expense] load error", error);
      setRows([]);
    } else {
      setRows(data || []);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const visible = useMemo(() => {
    if (!isAdmin) return rows.filter((r) => r.employee_id === currentEmployee?.id);
    if (filter === "all") return rows;
    if (filter === "paid") return rows.filter((r) => r.paid);
    if (filter === "mine") return rows.filter((r) => r.employee_id === currentEmployee?.id);
    return rows.filter((r) => r.status === filter);
  }, [rows, filter, isAdmin, currentEmployee?.id]);

  const counts = useMemo(() => {
    const c = { pending: 0, approved: 0, rejected: 0, paid: 0, mine: 0 };
    rows.forEach((r) => {
      c[r.status] = (c[r.status] || 0) + 1;
      if (r.paid) c.paid += 1;
      if (r.employee_id === currentEmployee?.id) c.mine += 1;
    });
    return c;
  }, [rows, currentEmployee?.id]);

  async function approve(row) {
    const { error } = await supabase
      .from("expense_reimbursements")
      .update({ status: "approved", reviewed_by: currentEmployee?.id || null, reviewed_at: new Date().toISOString(), reject_reason: null })
      .eq("id", row.id);
    if (error) return toastError(t("操作失敗"), { detail: error });
    load();
  }

  async function reject(row) {
    const reason = window.prompt(t("拒絕理由（選填）"), row.reject_reason || "");
    if (reason === null) return;
    const { error } = await supabase
      .from("expense_reimbursements")
      .update({ status: "rejected", reviewed_by: currentEmployee?.id || null, reviewed_at: new Date().toISOString(), reject_reason: reason || null })
      .eq("id", row.id);
    if (error) return toastError(t("操作失敗"), { detail: error });
    load();
  }

  async function togglePaid(row) {
    const next = !row.paid;
    const { error } = await supabase
      .from("expense_reimbursements")
      .update({ paid: next, paid_at: next ? new Date().toISOString() : null })
      .eq("id", row.id);
    if (error) return toastError(t("操作失敗"), { detail: error });
    load();
  }

  async function revertToPending(row) {
    if (!window.confirm(t("確認撤回審批，重置為待審批？"))) return;
    const { error } = await supabase
      .from("expense_reimbursements")
      .update({ status: "pending", reviewed_by: null, reviewed_at: null, reject_reason: null, paid: false, paid_at: null })
      .eq("id", row.id);
    if (error) return toastError(t("操作失敗"), { detail: error });
    load();
  }

  async function deleteRow(row) {
    if (!window.confirm(t("確認刪除這筆報銷？"))) return;
    const { error } = await supabase.from("expense_reimbursements").delete().eq("id", row.id);
    if (error) return toastError(t("刪除失敗"), { detail: error });
    load();
  }

  const approvedTotalsByCurrency = useMemo(() => {
    const m = {};
    visible.filter((r) => r.status === "approved").forEach((r) => {
      const c = r.currency || "RMB";
      m[c] = (m[c] || 0) + Number(r.amount || 0);
    });
    return m;
  }, [visible]);

  const tabs = isAdmin
    ? [
        { id: "pending", label: t("待審批"), count: counts.pending },
        { id: "approved", label: t("已通過"), count: counts.approved },
        { id: "rejected", label: t("已拒絕"), count: counts.rejected },
        { id: "paid", label: t("已打款"), count: counts.paid },
        { id: "mine", label: t("我的報銷"), count: counts.mine },
        { id: "all", label: t("全部"), count: rows.length },
      ]
    : [];

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#1a2138" }}>{t("報銷")}</div>
          <div style={{ fontSize: 13, color: "#8899cc", marginTop: 4 }}>
            {isAdmin
              ? t("審批 / 打款 / 查看所有員工報銷")
              : t("提交自己的報銷，等待審批與打款")}
          </div>
        </div>
        <button onClick={() => { setEditingRow(null); setShowForm(true); }}
          style={{ padding: "9px 20px", background: "#6382ff", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 14, fontWeight: 600 }}>
          + {t("新增報銷")}
        </button>
      </div>

      {isAdmin && (
        <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
          {tabs.map((tb) => (
            <button key={tb.id} onClick={() => setFilter(tb.id)}
              style={{
                padding: "7px 14px",
                background: filter === tb.id ? "#6382ff" : "#fff",
                color: filter === tb.id ? "#fff" : "#556",
                border: `1px solid ${filter === tb.id ? "#6382ff" : "#e0e4ec"}`,
                borderRadius: 7, cursor: "pointer", fontSize: 13, fontWeight: 600
              }}>
              {tb.label} <span style={{ opacity: 0.7, marginLeft: 4 }}>{tb.count}</span>
            </button>
          ))}
        </div>
      )}

      {!isAdmin && (
        <div style={{ marginBottom: 14, fontSize: 13, color: "#8899cc" }}>
          {t("我的報銷")} · {t("共")} {visible.length} {t("筆")}
        </div>
      )}

      {visible.length > 0 && (
        <div style={{ marginBottom: 12, fontSize: 13, color: "#556", display: "flex", gap: 18, flexWrap: "wrap" }}>
          <span>{t("可見")} {visible.length} {t("筆")}</span>
          {Object.entries(approvedTotalsByCurrency).map(([cur, sum]) => (
            <span key={cur}>{t("已通過總額")} {CURRENCY_SYMBOL[cur] || cur} {fmtAmount(sum)}</span>
          ))}
        </div>
      )}

      <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #eef0f5", overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#f7f8fc", color: "#556", textAlign: "left" }}>
                <th style={th}>{t("日期")}</th>
                {isAdmin && <th style={th}>{t("員工")}</th>}
                <th style={th}>{t("類別")}</th>
                <th style={{ ...th, textAlign: "right" }}>{t("金額")}</th>
                <th style={th}>{t("說明")}</th>
                <th style={th}>{t("收據")}</th>
                <th style={th}>{t("狀態")}</th>
                <th style={th}>{t("打款")}</th>
                <th style={th}>{t("操作")}</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={isAdmin ? 9 : 8} style={{ padding: 30, textAlign: "center", color: "#999" }}>{t("載入中…")}</td></tr>
              )}
              {!loading && visible.length === 0 && (
                <tr><td colSpan={isAdmin ? 9 : 8} style={{ padding: 30, textAlign: "center", color: "#999" }}>{t("暫無記錄")}</td></tr>
              )}
              {!loading && visible.map((r) => {
                const emp = empMap.get(r.employee_id);
                const canEditOwn = r.employee_id === currentEmployee?.id && r.status === "pending";
                return (
                  <tr key={r.id} style={{ borderTop: "1px solid #eef0f5" }}>
                    <td style={td}>{fmtDate(r.expense_date)}</td>
                    {isAdmin && <td style={td}>{emp?.name || t("（已刪除）")}</td>}
                    <td style={td}>{t(r.category)}</td>
                    <td style={{ ...td, textAlign: "right", fontWeight: 600, whiteSpace: "nowrap" }}>
                      {CURRENCY_SYMBOL[r.currency] || (r.currency ? r.currency + " " : "¥")} {fmtAmount(r.amount)}
                    </td>
                    <td style={{ ...td, maxWidth: 220, whiteSpace: "pre-wrap", color: "#556" }}>{r.description || "—"}</td>
                    <td style={td}>
                      {(r.receipt_urls || []).length === 0 ? <span style={{ color: "#bbb" }}>—</span> : (
                        <div style={{ display: "flex", gap: 4 }}>
                          {(r.receipt_urls || []).slice(0, 3).map((u, i) => (
                            <img key={i} src={u} alt="" onClick={() => setLightboxUrl(u)}
                              style={{ width: 36, height: 36, objectFit: "cover", borderRadius: 5, cursor: "zoom-in", border: "1px solid #e5e8ee" }} />
                          ))}
                          {(r.receipt_urls || []).length > 3 && (
                            <span style={{ fontSize: 11, color: "#999", alignSelf: "center", marginLeft: 4 }}>+{(r.receipt_urls || []).length - 3}</span>
                          )}
                        </div>
                      )}
                    </td>
                    <td style={td}>
                      <StatusChip status={r.status} t={t} />
                      {r.status === "rejected" && r.reject_reason && (
                        <div style={{ fontSize: 11, color: "#ef4444", marginTop: 3, maxWidth: 160 }}>{r.reject_reason}</div>
                      )}
                    </td>
                    <td style={td}>
                      {r.paid ? (
                        <span style={{ color: "#22c55e", fontWeight: 600 }}>✓ {fmtDate(r.paid_at)}</span>
                      ) : (
                        <span style={{ color: "#bbb" }}>{t("未打款")}</span>
                      )}
                    </td>
                    <td style={td}>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {isAdmin && r.status === "pending" && (
                          <>
                            <button onClick={() => approve(r)} style={btnSmGreen}>{t("通過")}</button>
                            <button onClick={() => reject(r)} style={btnSmRed}>{t("拒絕")}</button>
                          </>
                        )}
                        {isAdmin && r.status === "approved" && (
                          <button onClick={() => togglePaid(r)} style={r.paid ? btnSmGray : btnSmBlue}>
                            {r.paid ? t("撤銷打款") : t("標記已打款")}
                          </button>
                        )}
                        {isAdmin && (r.status === "approved" || r.status === "rejected") && (
                          <button onClick={() => revertToPending(r)} style={btnSmGray}>{t("撤回")}</button>
                        )}
                        {canEditOwn && (
                          <button onClick={() => { setEditingRow(r); setShowForm(true); }} style={btnSmGray}>{t("編輯")}</button>
                        )}
                        {(canEditOwn || isAdmin) && (
                          <button onClick={() => deleteRow(r)} style={btnSmRed}>{t("刪除")}</button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
        <ExpenseForm
          t={t}
          supabase={supabase}
          currentEmployee={currentEmployee}
          editing={editingRow}
          onClose={() => { setShowForm(false); setEditingRow(null); }}
          onSaved={() => { setShowForm(false); setEditingRow(null); load(); }}
        />
      )}

      <Lightbox url={lightboxUrl} onClose={() => setLightboxUrl("")} />
    </div>
  );
}

const th = { padding: "10px 14px", fontWeight: 600, fontSize: 12, textTransform: "uppercase", letterSpacing: 0.4 };
const td = { padding: "12px 14px", verticalAlign: "top" };
const btnSmGreen = { padding: "4px 10px", background: "#22c55e", color: "#fff", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 12, fontWeight: 600 };
const btnSmRed = { padding: "4px 10px", background: "#ef4444", color: "#fff", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 12, fontWeight: 600 };
const btnSmBlue = { padding: "4px 10px", background: "#6382ff", color: "#fff", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 12, fontWeight: 600 };
const btnSmGray = { padding: "4px 10px", background: "#fff", color: "#556", border: "1px solid #d8dce5", borderRadius: 5, cursor: "pointer", fontSize: 12, fontWeight: 600 };
