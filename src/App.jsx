import { useState, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@supabase/supabase-js";
import { INVOICE_SHELL_HEAD, INVOICE_PAGE, INVOICE_SHELL_TAIL } from "./invoiceTemplate.js";
import { RECEIPT_FRAGMENT } from "./receiptTemplate.js";

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

// 全量拉取指定表（HEAD 先取 count，再並行分頁拉所有資料）
async function fetchAllTable(table, orderCol, ascending = true) {
  const size = 1000;
  const { count, error: cErr } = await supabase.from(table).select("*", { count: "exact", head: true });
  if (cErr) throw new Error(`${table} count: ${cErr.message || cErr}`);
  const totalPages = Math.max(1, Math.ceil((count || 0) / size));
  const pagePromises = [];
  for (let i = 0; i < totalPages; i++) {
    const from = i * size;
    let q = supabase.from(table).select("*").range(from, from + size - 1);
    if (orderCol) q = q.order(orderCol, { ascending });
    pagePromises.push(q);
  }
  const results = await Promise.all(pagePromises);
  const all = [];
  for (const r of results) {
    if (r.error) throw new Error(`${table}: ${r.error.message || r.error}`);
    if (r.data) all.push(...r.data);
  }
  return all;
}

const LOGO_B64 = "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";

const CAR_BRANDS = ["Audi","BYD","BMW","Tesla","Volvo","MINI","MG","Mercedes Benz","KIA","MAXUS","Smart","Nissan","Lexus","Hyundai","Honda","Toyota","Porsche","Aion","Hyptec","XPeng","Volkswagen","IM Motors","Zeekr","Subaru","ORA","Wuling","Polestar","NETA","LOTUS","DENZA","Dongfeng","SERES","KGM","Deepal","JAECOO","其他-Other"];

const PRODUCTS_LIST = ["GBT轉CCS2 快充轉插","GBT轉CCS2 快充轉插 Pro","Magcar 3","GBT轉Type 2 中充轉插Pro","GBT轉Type 2 中充轉插","Type2 V2L 歐標放電裝置","Type 2 歐標充電線","Type2 歐標家用牆充"];

const REFERRAL_SOURCES = ["Facebook","Instagram","WhatsApp","Walk-in","Friend Referral","Shopify","Other"];

// ── ICONS ──────────────────────────────────────────────────────────────────────
const Icon = ({ name, size = 18 }) => {
  const icons = {
    dashboard: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>,
    product: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>,
    inventory: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="2"/><path d="M9 12h6M9 16h4"/></svg>,
    customer: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
    invoice: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="13" y2="17"/></svg>,
    warning: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>,
    check: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>,
    plus: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
    search: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
    back: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>,
    print: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>,
    trend_up: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>,
    car: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 17H3a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v9a2 2 0 0 1-2 2h-3"/><circle cx="7.5" cy="17.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></svg>,
    x: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  };
  return icons[name] || null;
};

const Badge = ({ status }) => {
  const map = {
    "In Stock": { bg: "#e8f5e9", color: "#2e7d32", dot: "#4caf50" },
    "Sold": { bg: "#e3f2fd", color: "#1565c0", dot: "#2196f3" },
    "Warranty Expiring": { bg: "#fff3e0", color: "#e65100", dot: "#ff9800" },
    "Expired": { bg: "#fce4ec", color: "#b71c1c", dot: "#f44336" },
    "Paid": { bg: "#e8f5e9", color: "#2e7d32", dot: "#4caf50" },
    "Unpaid": { bg: "#fce4ec", color: "#b71c1c", dot: "#f44336" },
    "Pending": { bg: "#fff3e0", color: "#e65100", dot: "#ff9800" },
    "VIP": { bg: "#f3e5f5", color: "#6a1b9a", dot: "#9c27b0" },
    "Regular": { bg: "#f5f5f5", color: "#424242", dot: "#9e9e9e" },
    "Lead": { bg: "#e3f2fd", color: "#1565c0", dot: "#2196f3" },
  };
  const s = map[status] || { bg: "#f5f5f5", color: "#333", dot: "#999" };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 10px", borderRadius: 20, background: s.bg, color: s.color, fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: s.dot }} />{status}
    </span>
  );
};

const StatCard = ({ label, value, sub, accent, icon, onClick }) => (
  <div onClick={onClick} style={{ background: "#fff", borderRadius: 16, padding: "24px 28px", border: "1px solid #f0f0f0", boxShadow: "0 2px 12px rgba(0,0,0,0.04)", display: "flex", flexDirection: "column", gap: 8, position: "relative", overflow: "hidden", cursor: onClick ? "pointer" : "default", transition: "transform 0.15s" }}
    onMouseEnter={e => { if (onClick) e.currentTarget.style.transform = "translateY(-2px)"; }}
    onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; }}>
    <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: accent, borderRadius: "16px 16px 0 0" }} />
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
      <div>
        <div style={{ fontSize: 13, color: "#888", fontWeight: 500, letterSpacing: "0.04em", textTransform: "uppercase" }}>{label}</div>
        <div style={{ fontSize: 32, fontWeight: 800, color: "#1a1a2e", lineHeight: 1.2, marginTop: 4 }}>{value}</div>
        {sub && <div style={{ fontSize: 13, color: "#aaa", marginTop: 4 }}>{sub}</div>}
      </div>
      <div style={{ width: 42, height: 42, borderRadius: 12, background: accent + "18", display: "flex", alignItems: "center", justifyContent: "center", color: accent }}>{icon}</div>
    </div>
  </div>
);

const Input = ({ label, value, onChange, placeholder, type = "text" }) => (
  <div style={{ marginBottom: 14 }}>
    <label style={{ fontSize: 13, fontWeight: 700, color: "#555", display: "block", marginBottom: 5 }}>{label}</label>
    <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid #e0e0e0", fontSize: 14, outline: "none", boxSizing: "border-box" }} />
  </div>
);

const Select = ({ label, value, onChange, options }) => (
  <div style={{ marginBottom: 14 }}>
    <label style={{ fontSize: 13, fontWeight: 700, color: "#555", display: "block", marginBottom: 5 }}>{label}</label>
    <select value={value} onChange={e => onChange(e.target.value)}
      style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid #e0e0e0", fontSize: 14, outline: "none", background: "#fff" }}>
      <option value="">Select...</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  </div>
);

// ── INVOICE PDF PRINT ──────────────────────────────────────────────────────────
// 使用 Google Doc 導出的 HTML 模板（src/invoiceTemplate.js），逐個 placeholder 替換
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// 規範化一條 item（兼容手工格式 + Shopify 同步格式）
// Shopify 同步：{ product: { legacyResourceId }, quantity, originalUnitPriceSet: { amount } }
// 手工：{ name, qty, price }
function normalizeItem(item, products) {
  if (!item || typeof item !== "object") return { name: "", qty: "", price: "" };
  const qty = item.qty ?? item.quantity ?? "";
  const price = item.price
    ?? (item.originalUnitPriceSet?.amount != null ? Number(item.originalUnitPriceSet.amount) : null)
    ?? (item.discountedUnitPriceSet?.amount != null ? Number(item.discountedUnitPriceSet.amount) : null)
    ?? "";
  // 產品名查找優先級：
  // 1. item.name / item.title（手工或 Shopify title 已帶入）
  // 2. 按價格在 products 表找：唯一 → 用；多個 → 優先當前促銷版（含"推廣"/"限時"）；否則取第一個
  // 3. 兜底通用名 "EV 充電配件"
  let name = item.name || item.title || "";
  if (!name && price !== "" && products?.length) {
    const priceNum = Number(price);
    const matches = products.filter(x => Number(x.price) === priceNum && x.name);
    if (matches.length === 1) {
      name = matches[0].name;
    } else if (matches.length > 1) {
      const promo = matches.find(x => /推廣|限時/.test(x.name));
      name = (promo || matches[0]).name;
    }
  }
  if (!name) name = "EV 充電配件";
  return { name, qty, price };
}

// 發票明細行的空白模板 —— id 用 randomUUID 確保 React key 穩定
// （避免刪中間行時後面的 input value 錯位到前面的位置）
function mkItem(warehouseId = null) {
  const id = (typeof crypto !== "undefined" && crypto.randomUUID)
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return { id, name: "", qty: 1, price: 0, warehouse_id: warehouseId };
}

// mode = { invoice: boolean, receipt: boolean }；都 false 直接返回
function printInvoice(inv, customer, items, products = [], mode = { invoice: true, receipt: true }) {
  if (!mode.invoice && !mode.receipt) return;
  let itemsArr = items;
  if (typeof itemsArr === "string") {
    try { itemsArr = JSON.parse(itemsArr); } catch { itemsArr = []; }
  }
  if (itemsArr && !Array.isArray(itemsArr)) itemsArr = [itemsArr];
  if (!Array.isArray(itemsArr)) itemsArr = [];
  itemsArr = itemsArr.map(it => normalizeItem(it, products));

  let invNumShort;
  if (inv.invoice_number) {
    invNumShort = String(inv.invoice_number).replace(/^DC/i, "");
  } else {
    const idStr = String(inv.id || "");
    invNumShort = idStr.replace(/^DC/i, "").split("-")[0];
  }

  const validItems = itemsArr.filter(x => x && (x.name || (x.qty !== "" && x.qty != null) || (x.price !== "" && x.price != null)));
  const rowsHtml = validItems.map(item => {
    const qty = item.qty !== "" && item.qty != null ? item.qty : "";
    const price = item.price !== "" && item.price != null ? item.price : "";
    return '<div class="table-row">' +
      '<div>' + escapeHtml(item.name || "") + '</div>' +
      '<div>' + escapeHtml(qty) + '</div>' +
      '<div class="col-price">' + escapeHtml(price) + '</div>' +
    '</div>';
  }).join("");

  const dateStr = escapeHtml(inv.date || new Date().toISOString().slice(0, 10));
  const subj = escapeHtml(invNumShort);
  const cname = escapeHtml(customer?.name || "");
  const cphone = escapeHtml(customer?.phone || "");
  const cemail = escapeHtml(customer?.email || "");
  const caddr = escapeHtml(customer?.address || "");
  const cmake = escapeHtml(customer?.car_make || "");
  const cmodel = escapeHtml(customer?.car_model || "");
  const total = escapeHtml(inv.total || 0);

  let invoicePage = "";
  if (mode.invoice) {
    invoicePage = INVOICE_PAGE
      .replace("{{subject_line}}", subj)
      .replace("{{date}}", dateStr)
      .replace("{{customer_name}}", cname)
      .replace("{{customer_phone}}", cphone)
      .replace("{{customer_email}}", cemail)
      .replace("{{customer_address}}", caddr)
      .replace("{{car_make}}", cmake)
      .replace("{{car_model}}", cmodel)
      .replace("{{Total_Sum}}", total)
      .replace("{{invoice_rows}}", rowsHtml);
  }

  let receiptPage = "";
  if (mode.receipt) {
    // 单独出收据时去掉 receipt-page 的 page-break-before，避免第一页前强制空白页
    const cls = mode.invoice ? "page receipt-page" : "page";
    receiptPage = RECEIPT_FRAGMENT
      .replace('class="page receipt-page"', 'class="' + cls + '"')
      .replace("{{r_subject_line}}", subj)
      .replace("{{r_date}}", dateStr)
      .replace("{{r_customer_name}}", cname)
      .replace("{{r_customer_phone}}", cphone)
      .replace("{{r_customer_email}}", cemail)
      .replace("{{r_customer_address}}", caddr)
      .replace("{{r_car_make}}", cmake)
      .replace("{{r_car_model}}", cmodel)
      .replace("{{r_Total_Sum}}", total)
      .replace("{{r_rows}}", rowsHtml);
  }

  const html = INVOICE_SHELL_HEAD + invoicePage + receiptPage + INVOICE_SHELL_TAIL;

  const w = window.open("", "_blank");
  if (!w) {
    alert("瀏覽器阻擋了彈出窗口，請允許本網站彈窗後再試一次。\n發票已生成，可以從發票列表再次點選列印。");
    return;
  }
  w.document.write(html);
  w.document.close();
  setTimeout(() => w.print(), 500);
}

// ── MAIN APP ───────────────────────────────────────────────────────────────────
export default function App() {
  // Supabase Auth：session 由 Supabase SDK 管理（localStorage 自動持久化 + 自動 refresh）
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPw, setLoginPw] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);

  const [tab, setTab] = useState("dashboard");
  const [products, setProducts] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [stocks, setStocks] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [showAddEmployee, setShowAddEmployee] = useState(false);
  const [newEmployee, setNewEmployee] = useState({ name: "", role: "", phone: "", email: "", note: "" });
  const [editingTask, setEditingTask] = useState(null); // 任務詳情 modal 當前任務
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [productOrgDraft, setProductOrgDraft] = useState(null);
  const [expandedSkuGroups, setExpandedSkuGroups] = useState(new Set());
  const [inventory, setInventory] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [search, setSearch] = useState("");
  const [productCategoryFilter, setProductCategoryFilter] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [showAddCustomer, setShowAddCustomer] = useState(false);
  const [showNewInvoice, setShowNewInvoice] = useState(false);
  const [invoiceGenerated, setInvoiceGenerated] = useState(false);
  const [saving, setSaving] = useState(false);
  const [visibleCustomers, setVisibleCustomers] = useState(30);
  const [visibleInvoices, setVisibleInvoices] = useState(30);
  const [visibleWarranty, setVisibleWarranty] = useState(50);
  const [warrantySearch, setWarrantySearch] = useState("");
  const [warrantyBucket, setWarrantyBucket] = useState("all"); // all | expired | soon | near | far
  const [revenueRange, setRevenueRange] = useState("12m"); // thisMonth | lastMonth | 3m | 12m | year | all
  const [dashSearch, setDashSearch] = useState("");
  const [editingCustomer, setEditingCustomer] = useState(null); // 当前被编辑的真实 customer 对象（单条记录，不是 virtualCustomer）
  const [editCustCid, setEditCustCid] = useState(""); // 合并组内选中要编辑的 cid
  // 多值字段（phone/phone_mainland/address/car_make/car_model）在表单里用 string[] 管理，每项对应一个 input
  const loadMultiField = raw => {
    const arr = String(raw || "").split(/\n+/).map(s => s.trim()).filter(Boolean);
    return arr.length > 0 ? arr : [""];
  };
  const buildEditForm = (src, allCustomers = customers) => {
    // src 可以是 virtualCustomer（有 allXxx 数组）或 raw customer
    const pickMulti = (arrKey, singleKey) => {
      const arr = src[arrKey];
      if (Array.isArray(arr) && arr.length > 0) return arr.slice();
      return loadMultiField(src[singleKey]);
    };
    // 物理合并的别名：parent_id = src.id 的子记录 name。同名合并成一行避免用户看到重复
    const physicalChildren = (allCustomers || []).filter(c => c.parent_id === src.id);
    const aliasNameToCids = new Map(); // 保留顺序：Map 默认按 insert 顺序
    for (const child of physicalChildren) {
      const n = (child.name || "").trim();
      if (!n) continue;
      if (!aliasNameToCids.has(n)) aliasNameToCids.set(n, []);
      aliasNameToCids.get(n).push(child.id);
    }
    const physicalAliases = Array.from(aliasNameToCids.keys());
    return {
      name: src.name || "",
      aliases: physicalAliases.length > 0 ? physicalAliases : [""],
      _originalAliases: physicalAliases.slice(),
      _originalAliasNameToCids: aliasNameToCids,
      phones: pickMulti('allPhones', 'phone'),
      phoneMainlands: pickMulti('allPhoneMainlands', 'phone_mainland'),
      emails: pickMulti('allEmails', 'email'),
      addresses: pickMulti('allAddresses', 'address'),
      carMakes: pickMulti('allCarMakes', 'car_make'),
      carModels: pickMulti('allCarModels', 'car_model'),
      type: src.type || "Regular",
      referral: src.referral || "",
    };
  };
  const [editCustForm, setEditCustForm] = useState(buildEditForm({}));
  const [editCustSaving, setEditCustSaving] = useState(false);
  const [mergeHistoryOpen, setMergeHistoryOpen] = useState(null); // virtualCustomer 或 null
  const [mergeCandidatesOpen, setMergeCandidatesOpen] = useState(false); // 一键合并弹窗
  // 回退合併 modal：{ vc, clickedCid } — 從合併記錄 modal 點某條非主記錄的「回退」打開
  const [rollbackOpen, setRollbackOpen] = useState(null);
  const [rollbackAffected, setRollbackAffected] = useState(new Set());
  const [rollbackTarget, setRollbackTarget] = useState("independent"); // 'independent' | 'mergeTo'
  const [rollbackMergeTo, setRollbackMergeTo] = useState("");
  const [rollbackMergeToQuery, setRollbackMergeToQuery] = useState("");
  const [rollbackMergeToOpen, setRollbackMergeToOpen] = useState(false);
  const [rollbackFields, setRollbackFields] = useState({});
  const [rollbackBusy, setRollbackBusy] = useState(false);
  const openRollback = (vc, clickedCid) => {
    setRollbackOpen({ vc, clickedCid });
    setRollbackAffected(new Set([clickedCid]));
    setRollbackTarget("independent");
    setRollbackMergeTo("");
    setRollbackMergeToQuery("");
    setRollbackMergeToOpen(false);
    setRollbackFields({});
  };
  async function handleRollback() {
    if (!rollbackOpen) return;
    const { vc, clickedCid } = rollbackOpen;
    const primaryCid = vc.id;
    const affected = Array.from(rollbackAffected);
    if (affected.length === 0) { alert("請至少勾選一條要回退的記錄"); return; }
    if (rollbackTarget === "mergeTo" && !rollbackMergeTo) { alert("請選擇要合併到的客戶"); return; }
    if (rollbackTarget === "mergeTo" && affected.includes(rollbackMergeTo)) { alert("不能合併到自己"); return; }
    setRollbackBusy(true);
    const MULTI_DB = ["phone", "phone_mainland", "email", "address", "car_make", "car_model"];
    const patches = new Map(); // cid -> patch
    for (const cid of affected) {
      const rec = customers.find(c => c.id === cid);
      if (!rec) continue;
      const patch = {};
      if (rollbackTarget === "independent") {
        if (rec.parent_id) {
          patch.parent_id = null;
        } else {
          const existing = Array.isArray(rec.merge_exclude) ? rec.merge_exclude : [];
          patch.merge_exclude = [...new Set([...existing, primaryCid])];
        }
      } else if (rollbackTarget === "mergeTo") {
        patch.parent_id = rollbackMergeTo;
        patch.merge_exclude = [];
      }
      if (cid === clickedCid) {
        for (const dbKey of MULTI_DB) {
          if (rollbackFields[dbKey] === undefined) continue;
          if (rollbackFields[dbKey] === "__clear__") patch[dbKey] = null;
          else if (rollbackFields[dbKey] !== "") patch[dbKey] = rollbackFields[dbKey];
        }
      }
      if (Object.keys(patch).length > 0) patches.set(cid, patch);
    }
    for (const [cid, patch] of patches) {
      const { error } = await supabase.from("customers").update(patch).eq("id", cid);
      if (error) { setRollbackBusy(false); alert("回退失敗：" + error.message); return; }
    }
    if (patches.size > 0) {
      setCustomers(prev => prev.map(c => patches.has(c.id) ? { ...c, ...patches.get(c.id) } : c));
    }
    setRollbackBusy(false);
    setRollbackOpen(null);
    setMergeHistoryOpen(null);
  }
  async function handleUnmerge(childCid) {
    const ok = window.confirm(`確定撤銷此合併？該記錄會變回獨立客戶，發票關聯不變。`);
    if (!ok) return;
    const { error } = await supabase.from("customers").update({ parent_id: null }).eq("id", childCid);
    if (error) { alert("撤銷失敗：" + error.message); return; }
    setCustomers(prev => prev.map(c => c.id === childCid ? { ...c, parent_id: null } : c));
  }
  async function handleUpgradePhysical(vc) {
    const primaryCid = vc?.id;
    if (!primaryCid) return;
    const siblings = (vc.groupCids || []).filter(id => id !== primaryCid);
    if (siblings.length === 0) return;
    const ok = window.confirm(
      `確定把 ${siblings.length} 條疑似重複的記錄物理合併到「${vc.name || '(無名)'}」?\n\n` +
      `合併後這些記錄會掛在主記錄下，字段（電話/郵箱/地址等）歸主記錄管理；\n` +
      `下次編輯時刪除字段才會真生效。可在合併記錄裡隨時點「撤銷合併」還原。`
    );
    if (!ok) return;
    const { error } = await supabase.from("customers").update({ parent_id: primaryCid }).in("id", siblings);
    if (error) { alert("升級物理合併失敗：" + error.message); return; }
    setCustomers(prev => prev.map(c => siblings.includes(c.id) ? { ...c, parent_id: primaryCid } : c));
    setMergeHistoryOpen(null);
  }
  const openEditCustomer = (virtualC) => {
    const cids = virtualC.groupCids || [virtualC.id];
    // 默认编辑 primary（= virtualC.id = root cid 真实记录）
    const primaryCid = cids.find(id => customers.find(c => c.id === id && (c.name || "").trim())) || cids[0];
    const real = customers.find(c => c.id === primaryCid);
    if (!real) return;
    setEditingCustomer(real);
    setEditCustCid(primaryCid);
    // 用 virtualC（合并组聚合版）load 多值字段，这样编辑弹窗能看到所有地址/电话/别名
    setEditCustForm(buildEditForm(virtualC));
  };
  const switchEditCustCid = (cid) => {
    const real = customers.find(c => c.id === cid);
    if (!real) return;
    setEditingCustomer(real);
    setEditCustCid(cid);
    setEditCustForm(buildEditForm(real));
  };
  async function handleSaveCustomerEdit() {
    console.log("[SAVE] start", { editCustCid, editingCustomerId: editingCustomer?.id, form: editCustForm });
    if (!editingCustomer || !editCustCid) { console.log("[SAVE] early return"); return; }
    setEditCustSaving(true);
    const joinArr = arr => (arr || []).map(s => String(s).trim()).filter(Boolean).join("\n") || null;
    const patch = {
      name: editCustForm.name.trim() || null,
      phone: joinArr(editCustForm.phones),
      phone_mainland: joinArr(editCustForm.phoneMainlands),
      email: joinArr(editCustForm.emails),
      address: joinArr(editCustForm.addresses),
      car_make: joinArr(editCustForm.carMakes),
      car_model: joinArr(editCustForm.carModels),
      type: editCustForm.type || "Regular",
      referral: editCustForm.referral.trim() || null,
    };
    console.log("[SAVE] patch", patch);
    const { data: updData, error, status: updStatus } = await supabase.from("customers").update(patch).eq("id", editCustCid).select();
    console.log("[SAVE] update result", { updData, error, updStatus });
    if (error) { setEditCustSaving(false); alert("保存失敗：" + error.message); return; }
    // 多值字段「反向清理」：form 裡被刪除的值，合并组内其他成員（rule 1 獨立 + 物理子）
    // 對應字段也要移除，否則 customerGroups 聚合會把被刪的值從其他成員裡拉回來。
    const splitMulti = v => String(v || "").split(/\n+/).map(s => s.trim()).filter(Boolean);
    const MULTI_FIELDS = [
      { formKey: "phones", dbKey: "phone" },
      { formKey: "phoneMainlands", dbKey: "phone_mainland" },
      { formKey: "emails", dbKey: "email" },
      { formKey: "addresses", dbKey: "address" },
      { formKey: "carMakes", dbKey: "car_make" },
      { formKey: "carModels", dbKey: "car_model" },
    ];
    const _gid = customerGroups.idToGroup.get(editCustCid);
    const _vc = _gid ? customerGroups.virtualCustomers.find(v => v.id === _gid) : null;
    const relatedCids = [
      ...((_vc?.groupCids || []).filter(id => id !== editCustCid)),
      ...((_vc?.mergedChildCids) || []),
    ];
    const siblingPatchMap = new Map(); // cid -> patch
    for (const sibCid of relatedCids) {
      const sib = customers.find(c => c.id === sibCid);
      if (!sib) continue;
      const sibPatch = {};
      for (const { formKey, dbKey } of MULTI_FIELDS) {
        const newValues = (editCustForm[formKey] || []).map(s => String(s).trim()).filter(Boolean);
        const newSet = new Set(newValues);
        const sibCurrent = splitMulti(sib[dbKey]);
        const filtered = sibCurrent.filter(v => newSet.has(v));
        if (filtered.length !== sibCurrent.length) {
          sibPatch[dbKey] = filtered.length > 0 ? filtered.join("\n") : null;
        }
      }
      if (Object.keys(sibPatch).length > 0) siblingPatchMap.set(sibCid, sibPatch);
    }
    for (const [sibCid, sibPatch] of siblingPatchMap) {
      const { error: e } = await supabase.from("customers").update(sibPatch).eq("id", sibCid);
      if (e) { setEditCustSaving(false); alert("關聯記錄更新失敗：" + e.message); return; }
    }
    if (siblingPatchMap.size > 0) {
      setCustomers(prev => prev.map(c => siblingPatchMap.has(c.id) ? { ...c, ...siblingPatchMap.get(c.id) } : c));
    }
    // 別名處理（name-based diff，不用 index 對齊）：
    // - 新增的 name：優先 adopt rule 1 同名獨立 customer（UPDATE parent_id），否則 INSERT
    // - 移除的 name：對應所有物理子 UPDATE parent_id = null（降級成獨立 customer，保留字段和發票關聯，不刪除）
    // 物理子字段不主動清空，避免用户操作丟失原始數據
    const normName = s => String(s || "").trim().toLowerCase();
    const newNames = (editCustForm.aliases || []).map(s => String(s).trim()).filter(Boolean);
    const oldNames = editCustForm._originalAliases || [];
    const oldNameToCids = editCustForm._originalAliasNameToCids || new Map();
    const newNameSet = new Set(newNames.map(normName));
    const oldNameSet = new Set(oldNames.map(normName));
    const namesToAdd = newNames.filter(n => !oldNameSet.has(normName(n)));
    const namesToRemove = oldNames.filter(n => !newNameSet.has(normName(n)));
    const cidsToDowngrade = [];
    for (const n of namesToRemove) {
      const cids = oldNameToCids.get(n) || [];
      cidsToDowngrade.push(...cids);
    }
    if (cidsToDowngrade.length > 0) {
      const { error: e } = await supabase.from("customers").update({ parent_id: null }).in("id", cidsToDowngrade);
      if (e) { setEditCustSaving(false); alert("別名降級失敗：" + e.message); return; }
    }
    // Add: 先查當前合并组里 rule 1 的独立成员，同名直接 UPDATE parent_id；否則 INSERT 新子記錄
    const gid = customerGroups.idToGroup.get(editCustCid);
    const curVc = gid ? customerGroups.virtualCustomers.find(v => v.id === gid) : null;
    const groupCids = curVc?.groupCids || [editCustCid];
    const ruleOneSiblings = customers.filter(c =>
      groupCids.includes(c.id) && c.id !== editCustCid && !c.parent_id
    );
    const usedSiblingIds = new Set();
    const insertedRows = [];
    const adoptedRows = [];
    for (const aliasName of namesToAdd) {
      const match = ruleOneSiblings.find(s => !usedSiblingIds.has(s.id) && normName(s.name) === normName(aliasName));
      if (match) {
        const { data, error: e } = await supabase.from("customers").update({ parent_id: editCustCid }).eq("id", match.id).select().single();
        if (e) { setEditCustSaving(false); alert("別名合併失敗：" + e.message); return; }
        usedSiblingIds.add(match.id);
        if (data) adoptedRows.push(data);
      } else {
        const { data, error: e } = await supabase.from("customers").insert({
          name: aliasName, parent_id: editCustCid, type: editCustForm.type || "Regular"
        }).select().single();
        if (e) { setEditCustSaving(false); alert("別名新增失敗：" + e.message); return; }
        if (data) insertedRows.push(data);
      }
    }
    setEditCustSaving(false);
    setCustomers(prev => {
      let next = prev.map(c => c.id === editCustCid ? { ...c, ...patch } : c);
      if (cidsToDowngrade.length > 0) {
        const dset = new Set(cidsToDowngrade);
        next = next.map(c => dset.has(c.id) ? { ...c, parent_id: null } : c);
      }
      if (adoptedRows.length > 0) {
        const adoptedMap = new Map(adoptedRows.map(r => [r.id, r]));
        next = next.map(c => adoptedMap.has(c.id) ? { ...c, ...adoptedMap.get(c.id) } : c);
      }
      if (insertedRows.length > 0) next = [...next, ...insertedRows];
      return next;
    });
    setEditingCustomer(null);
  }
  const [printChooser, setPrintChooser] = useState(null); // { inv, customer, items, products } | null
  const [printWantInvoice, setPrintWantInvoice] = useState(true);
  const [printWantReceipt, setPrintWantReceipt] = useState(true);
  const [pendingMerge, setPendingMerge] = useState(null); // { inv, newCustomer, oldCustomer, items, products }
  const [mergeBusy, setMergeBusy] = useState(false);
  const [mergeChoices, setMergeChoices] = useState({}); // { [field]: 'keep' | 'overwrite' | 'append' }，仅用于差異字段
  // 多值字段打印前的选择弹窗（车型/地址客户存了多行，要先挑一组）
  const [printFieldChooser, setPrintFieldChooser] = useState(null); // { inv, customer, items, products, multi: { field: [values...] } }
  const [printFieldChoices, setPrintFieldChoices] = useState({}); // { [field]: selected_value }
  const splitMulti = v => String(v || "").split(/\n+/).map(s => s.trim()).filter(Boolean);
  const PRINT_FIELD_DEFS = [
    { key: "name", label: "姓名", arr: "allNames" },
    { key: "phone", label: "香港電話", arr: "allPhones" },
    { key: "phone_mainland", label: "內地電話", arr: "allPhoneMainlands" },
    { key: "email", label: "郵箱", arr: "allEmails" },
    { key: "address", label: "地址", arr: "allAddresses" },
    { key: "car_make", label: "車品牌", arr: "allCarMakes" },
    { key: "car_model", label: "車型", arr: "allCarModels" },
  ];
  const enterPrintFlow = (inv, customer, items, products) => {
    const multi = {};
    for (const def of PRINT_FIELD_DEFS) {
      const arrVals = def.arr && Array.isArray(customer?.[def.arr]) ? customer[def.arr] : [];
      const singleVal = customer?.[def.key];
      const sources = arrVals.length > 0 ? arrVals : (singleVal ? [singleVal] : []);
      const vals = [...new Set(sources.flatMap(v => splitMulti(v)))];
      if (vals.length > 1) multi[def.key] = vals;
    }
    if (Object.keys(multi).length > 0) {
      const defaults = {};
      Object.keys(multi).forEach(f => { defaults[f] = multi[f][0]; });
      setPrintFieldChoices(defaults);
      setPrintFieldChooser({ inv, customer, items, products, multi });
      return;
    }
    setPrintWantInvoice(true);
    setPrintWantReceipt(true);
    setPrintChooser({ inv, customer, items, products });
  };
  const openPrintChooser = (inv, customer, items, products) => {
    // 检查 __PENDING_MERGE__:<oldCid> 标记
    const m = (inv?.notes || "").match(/__PENDING_MERGE__:([\w-]+)/);
    if (m) {
      const oldCid = m[1];
      const oldCust = customers.find(c => c.id === oldCid);
      if (oldCust) {
        setMergeChoices({});
        setPendingMerge({ inv, newCustomer: customer, oldCustomer: oldCust, items, products });
        return;
      }
      // 如果老客户已被删/找不到，直接清标记继续
    }
    // 总是用合并组聚合版（virtualCustomer），拿到 allXxx 多值字段
    const gid = customerGroups.idToGroup.get(customer?.id);
    const virtual = gid ? customerGroups.virtualCustomers.find(v => v.id === gid) : null;
    enterPrintFlow(inv, virtual || customer, items, products);
  };
  async function handleConfirmMerge() {
    if (!pendingMerge) return;
    setMergeBusy(true);
    const { inv, newCustomer, oldCustomer, items, products } = pendingMerge;
    const isEmpty = v => v == null || String(v).trim() === "";
    const eqVal = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
    const patch = {};
    for (const key of ["name", "phone", "phone_mainland", "email", "address", "car_make", "car_model", "referral"]) {
      const oldV = oldCustomer[key];
      const newV = newCustomer[key];
      if (isEmpty(oldV) && !isEmpty(newV)) {
        // 老空新有 → 自动补（🆕 NEW）
        patch[key] = newV;
      } else if (!isEmpty(oldV) && !isEmpty(newV) && !eqVal(oldV, newV)) {
        // 差異 → 按运营选择
        const choice = mergeChoices[key] || "keep";
        if (choice === "overwrite") patch[key] = newV;
        else if (choice === "append") patch[key] = String(oldV).trim() + "\n" + String(newV).trim();
        // keep 不动
      }
    }
    if (Object.keys(patch).length > 0) {
      const { error } = await supabase.from("customers").update(patch).eq("id", oldCustomer.id);
      if (error) { alert("合併失敗（更新老客戶）：" + error.message); setMergeBusy(false); return; }
    }
    const newNotes = (inv.notes || "").replace(/\s*__PENDING_MERGE__:[\w-]+/g, "").trim();
    const { error: invErr } = await supabase.from("invoices").update({ customer_id: oldCustomer.id, notes: newNotes }).eq("id", inv.id);
    if (invErr) { alert("合併失敗（更新發票）：" + invErr.message); setMergeBusy(false); return; }
    // 如果临时新客户没挂其他发票，删掉
    const { data: otherInvs } = await supabase.from("invoices").select("id").eq("customer_id", newCustomer.id).neq("id", inv.id).limit(1);
    let deletedNewCust = false;
    if (!otherInvs || otherInvs.length === 0) {
      await supabase.from("customers").delete().eq("id", newCustomer.id);
      deletedNewCust = true;
    }
    const mergedOld = { ...oldCustomer, ...patch };
    setCustomers(prev => {
      let next = prev.map(c => c.id === oldCustomer.id ? mergedOld : c);
      if (deletedNewCust) next = next.filter(c => c.id !== newCustomer.id);
      return next;
    });
    const mergedInv = { ...inv, customer_id: oldCustomer.id, notes: newNotes };
    setInvoices(prev => prev.map(i => i.id === inv.id ? mergedInv : i));
    setMergeBusy(false);
    setPendingMerge(null);
    // 合并完自动进入列印 flow（若老客户多值会先弹字段选择）
    enterPrintFlow(mergedInv, mergedOld, items, products);
  }
  const [editingInvoice, setEditingInvoice] = useState(null); // 正在編輯的發票對象
  const [markPaidCtx, setMarkPaidCtx] = useState(null); // { inv, defaultWh } —— 標記已付款彈窗
  const [stockToast, setStockToast] = useState(null); // { items: [name] } —— 右下角庫存不足 toast
  const [editInvItems, setEditInvItems] = useState([]);
  const [editInvTotalOverride, setEditInvTotalOverride] = useState(""); // 空字串 = 跟隨明細合計；非空 = 手動覆蓋
  const [editInvExtras, setEditInvExtras] = useState({
    deposit: { enabled: false, amount: 0 },
    discount: { enabled: false, amount: 0 },
    surcharge: { enabled: false, amount: 0 },
  });
  const [customerSort, setCustomerSort] = useState("created");
  const [customerSortDir, setCustomerSortDir] = useState("desc");
  const [customerTimeRange, setCustomerTimeRange] = useState("all");
  const [editingProduct, setEditingProduct] = useState(null);
  const [editStock, setEditStock] = useState(0);
  const [editStocks, setEditStocks] = useState({});

  const [newCustomer, setNewCustomer] = useState({
    name: "", email: "", phone: "", phone_mainland: "",
    car_make: "", car_model: "", address: "",
    interest_products: [], referral: "", type: "Lead", notes: ""
  });

  const [newInvoice, setNewInvoice] = useState({
    customerId: "", items: [mkItem()], notes: "", warranty: false,
    deposit: { enabled: false, amount: 0 },
    discount: { enabled: false, amount: 0 },
    surcharge: { enabled: false, amount: 0 },
    fieldOverrides: {},
  });
  // 新建發票彈窗的搜索框 picker state
  const [customerQuery, setCustomerQuery] = useState("");          // 客戶搜索輸入框文字
  const [customerDropdownOpen, setCustomerDropdownOpen] = useState(false);
  const [productPickerOpenId, setProductPickerOpenId] = useState(null); // 哪條明細行的產品 picker 正開著 (item.id)

  // 關閉新建發票彈窗 → 一次清掉所有殘留（避免下次打開時看到上次的選擇）
  function closeNewInvoice() {
    setShowNewInvoice(false);
    setNewInvoice({
      customerId: "", items: [mkItem()], notes: "", warranty: false,
      deposit: { enabled: false, amount: 0 },
      discount: { enabled: false, amount: 0 },
      surcharge: { enabled: false, amount: 0 },
      fieldOverrides: {},
    });
    setCustomerQuery("");
    setCustomerDropdownOpen(false);
    setProductPickerOpenId(null);
  }

  // 客戶頁過濾/排序：按需計算最近購買日期 + 搜索 + 時間範圍 + 排序
  // 客戶去重：
  //   規則 1（虛擬合併，union-find）：name/phone/email/address 4 字段命中 3+ 視為疑似同人
  //   規則 2（物理合併，DB parent_id）：除 name 外所有字段完全相等 + name 都非空 → UPDATE parent_id = keeper.id
  //     parent_id 非空的子記錄不作為獨立客戶顯示，名字作別名加入 keeper 的 allNames
  const customerGroups = useMemo(() => {
    const norm = s => (s || "").trim().toLowerCase();
    const fields = ["name", "phone", "email", "address"];
    // 地址模糊匹配：edit distance ≤ 1 視為相同（容忍 1 個字的錯漏）
    const editDist1 = (a, b) => {
      if (a === b) return true;
      const la = a.length, lb = b.length;
      if (Math.abs(la - lb) > 1) return false;
      // 最多 1 次編輯：替換/插入/刪除
      let i = 0, j = 0, edits = 0;
      while (i < la && j < lb) {
        if (a[i] === b[j]) { i++; j++; continue; }
        if (++edits > 1) return false;
        if (la === lb) { i++; j++; }         // 替換
        else if (la > lb) i++;               // a 多一字，刪 a
        else j++;                            // b 多一字，刪 b
      }
      if (i < la || j < lb) edits++;
      return edits <= 1;
    };
    const splitAddr = s => String(s || "").split(/\n+/).map(x => x.trim().toLowerCase()).filter(Boolean);
    const addrMatch = (a, b) => {
      const A = splitAddr(a), B = splitAddr(b);
      if (A.length === 0 || B.length === 0) return false;
      for (const x of A) for (const y of B) if (editDist1(x, y)) return true;
      return false;
    };
    const idToCustomer = new Map();
    customers.forEach(c => idToCustomer.set(c.id, c));
    // 規則 2 子記錄：parent_id 非空的 customer，按 parent_id 分組
    const childrenByParent = new Map(); // parentId -> [child customers]
    customers.forEach(c => {
      if (c.parent_id) {
        if (!childrenByParent.has(c.parent_id)) childrenByParent.set(c.parent_id, []);
        childrenByParent.get(c.parent_id).push(c);
      }
    });
    // 只用 parent_id IS NULL 的 customer 做 union-find（子記錄不獨立成組）
    const independents = customers.filter(c => !c.parent_id);
    const indexes = fields.map(() => new Map());
    independents.forEach(c => {
      fields.forEach((f, i) => {
        const v = norm(c[f]);
        if (!v) return;
        if (!indexes[i].has(v)) indexes[i].set(v, []);
        indexes[i].get(v).push(c.id);
      });
    });
    const parent = new Map();
    independents.forEach(c => parent.set(c.id, c.id));
    const find = x => {
      let r = x;
      while (parent.get(r) !== r) r = parent.get(r);
      let cur = x;
      while (parent.get(cur) !== r) { const nx = parent.get(cur); parent.set(cur, r); cur = nx; }
      return r;
    };
    independents.forEach(c => {
      const candidates = new Set();
      fields.forEach((f, i) => {
        const v = norm(c[f]);
        if (!v) return;
        indexes[i].get(v)?.forEach(id => { if (id !== c.id) candidates.add(id); });
      });
      candidates.forEach(id => {
        const other = idToCustomer.get(id);
        if (!other) return;
        // 回退合併：若任一方把對方加入 merge_exclude，跳過自動合併
        const ex1 = Array.isArray(c.merge_exclude) ? c.merge_exclude : [];
        const ex2 = Array.isArray(other.merge_exclude) ? other.merge_exclude : [];
        if (ex1.includes(other.id) || ex2.includes(c.id)) return;
        let matches = 0;
        fields.forEach(f => {
          if (f === "address") {
            if (addrMatch(c.address, other.address)) matches++;
          } else {
            const a = norm(c[f]), b = norm(other[f]);
            if (a && a === b) matches++;
          }
        });
        if (matches >= 3) {
          const ra = find(c.id), rb = find(id);
          if (ra !== rb) parent.set(ra, rb);
        }
      });
    });
    const groupInfo = new Map();
    const splitLines = v => String(v || "").split(/\n+/).map(s => s.trim()).filter(Boolean);
    // 把 keeper 自身 + 物理子記錄的字段一起算進 group
    const absorb = (g, c) => {
      const n = (c.name || "").trim(); if (n) g.names.add(n);
      splitLines(c.phone).forEach(v => g.phones.add(v));
      splitLines(c.email).forEach(v => g.emails.add(v));
      splitLines(c.address).forEach(v => g.addresses.add(v));
      splitLines(c.phone_mainland).forEach(v => g.phoneMainlands.add(v));
      splitLines(c.car_make).forEach(v => g.carMakes.add(v));
      splitLines(c.car_model).forEach(v => g.carModels.add(v));
    };
    independents.forEach(c => {
      const root = find(c.id);
      if (!groupInfo.has(root)) groupInfo.set(root, {
        cids: [], childCids: [], names: new Set(), phones: new Set(), emails: new Set(), addresses: new Set(),
        phoneMainlands: new Set(), carMakes: new Set(), carModels: new Set(),
      });
      const g = groupInfo.get(root);
      g.cids.push(c.id);
      absorb(g, c);
      // 把規則 2 合併的子記錄吸進來
      (childrenByParent.get(c.id) || []).forEach(child => {
        g.childCids.push(child.id);
        absorb(g, child);
      });
    });
    // 預先算每個 group 的 primaryCid，讓 virtualC.id 直接用 primaryCid（避免 root 跟 primary 不一致導致 parent_id 引用錯亂）
    const rootToPrimary = new Map();
    groupInfo.forEach((info, root) => {
      const primaryCid = info.cids.find(cid => {
        const x = idToCustomer.get(cid);
        return x && (x.name || "").trim();
      }) || info.cids[0];
      rootToPrimary.set(root, primaryCid);
    });
    const idToGroup = new Map();
    independents.forEach(c => {
      const root = find(c.id);
      idToGroup.set(c.id, rootToPrimary.get(root) || root);
    });
    // 子記錄 → 指向其 parent 所在的 group primary
    customers.forEach(c => {
      if (c.parent_id && !idToGroup.has(c.id)) {
        const mapped = idToGroup.get(c.parent_id);
        if (mapped) idToGroup.set(c.id, mapped);
      }
    });
    // 構造 virtualCustomers：每組合併成一條，主信息取組內第一個有 name 的
    const virtualCustomers = [];
    groupInfo.forEach((info, root) => {
      const primaryCid = rootToPrimary.get(root);
      const primary = idToCustomer.get(primaryCid) || {};
      const earliestCreated = info.cids
        .map(cid => idToCustomer.get(cid)?.created_at)
        .filter(Boolean)
        .sort()[0];
      const allNames = Array.from(info.names);
      const allPhones = Array.from(info.phones);
      const allEmails = Array.from(info.emails);
      const allAddresses = Array.from(info.addresses);
      const allPhoneMainlands = Array.from(info.phoneMainlands);
      const allCarMakes = Array.from(info.carMakes);
      const allCarModels = Array.from(info.carModels);
      virtualCustomers.push({
        ...primary,
        id: primaryCid,                // 用 primaryCid 而非 union-find root，让 parent_id 引用稳定
        groupCids: info.cids,          // rule 1 虛擬合併（獨立 customer id 列表）
        mergedChildCids: info.childCids, // rule 2 物理合併的子記錄 id
        allCids: [...info.cids, ...info.childCids], // 查發票用：包含所有相關 customer_id
        allNames,
        allPhones,
        allEmails,
        allAddresses,
        allPhoneMainlands,
        allCarMakes,
        allCarModels,
        name: (primary.name || "").trim() || allNames[0] || "",
        phone: (primary.phone || "").trim() || allPhones[0] || "",
        email: (primary.email || "").trim() || allEmails[0] || "",
        address: (primary.address || "").trim() || allAddresses[0] || "",
        phone_mainland: allPhoneMainlands.join("\n") || primary.phone_mainland || "",
        car_make: allCarMakes.join("\n") || primary.car_make || "",
        car_model: allCarModels.join("\n") || primary.car_model || "",
        created_at: earliestCreated,
      });
    });
    return { idToGroup, groupInfo, virtualCustomers };
  }, [customers]);

  // selectedCustomer 是 virtualCustomer 的快照，customers 變化後需要重新同步，
  // 否則保存後用戶看到的還是舊聚合字段（allAddresses/allPhones/... 不刷新）
  useEffect(() => {
    if (!selectedCustomer) return;
    const gid = customerGroups.idToGroup.get(selectedCustomer.id);
    const fresh = gid ? customerGroups.virtualCustomers.find(v => v.id === gid) : null;
    if (!fresh || fresh.id !== selectedCustomer.id) return;
    const snapshot = v => JSON.stringify([
      v.allCids, v.allAddresses, v.allPhones, v.allEmails, v.allNames,
      v.allPhoneMainlands, v.allCarMakes, v.allCarModels,
      v.name, v.phone, v.email, v.address, v.car_make, v.car_model
    ]);
    if (snapshot(fresh) !== snapshot(selectedCustomer)) {
      setSelectedCustomer(fresh);
    }
  }, [customerGroups]);

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
  }, [customerGroups, invoices, search, customerSort, customerSortDir, customerTimeRange]);

  // 發票頁過濾：按搜索關鍵字 (發票號 / 客戶名 / 備註)
  const filteredInvoices = useMemo(() => {
    const q = search.toLowerCase();
    const base = !q ? invoices : invoices.filter(inv => {
      const c = customers.find(x => x.id === inv.customer_id);
      return String(inv.invoice_number || "").toLowerCase().includes(q)
        || (c?.name || "").toLowerCase().includes(q)
        || (inv.notes || "").toLowerCase().includes(q);
    });
    return [...base].sort((a, b) => {
      const da = a.date || "", db = b.date || "";
      if (da !== db) return db.localeCompare(da);
      return String(b.created_at || "").localeCompare(String(a.created_at || ""));
    });
  }, [invoices, customers, search]);

  // Supabase Auth：初始化 + 監聽 session 變化
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    return () => subscription.unsubscribe();
  }, []);

  // 登入後才加載數據 — 用 user.id 作為依賴
  const userId = session?.user?.id;
  const queryClient = useQueryClient();

  // 使用 React Query 管理 4 張表的 fetch + 緩存
  const qProducts = useQuery({ queryKey: ["bf", "products"], queryFn: () => fetchAllTable("products", "name"), enabled: !!userId });
  const qInventory = useQuery({ queryKey: ["bf", "inventory"], queryFn: () => fetchAllTable("inventory", null), enabled: !!userId });
  const qCustomers = useQuery({ queryKey: ["bf", "customers"], queryFn: () => fetchAllTable("customers", "name"), enabled: !!userId });
  const qInvoices = useQuery({ queryKey: ["bf", "invoices"], queryFn: () => fetchAllTable("invoices", "date", false), enabled: !!userId });
  const qWarehouses = useQuery({ queryKey: ["bf", "warehouses"], queryFn: () => fetchAllTable("warehouses", "sort_order"), enabled: !!userId });
  const qStocks = useQuery({ queryKey: ["bf", "inventory_stock"], queryFn: () => fetchAllTable("inventory_stock", null), enabled: !!userId });
  const qEmployees = useQuery({ queryKey: ["bf", "employees"], queryFn: () => fetchAllTable("employees", "created_at"), enabled: !!userId });
  const qTasks = useQuery({ queryKey: ["bf", "employee_tasks"], queryFn: () => fetchAllTable("employee_tasks", "created_at"), enabled: !!userId });

  // query data 同步到現有 useState，現存的 mutation 代碼（setCustomers 等）照舊工作
  useEffect(() => { if (qProducts.data) setProducts(qProducts.data); }, [qProducts.data]);
  useEffect(() => { if (qInventory.data) setInventory(qInventory.data); }, [qInventory.data]);
  useEffect(() => { if (qCustomers.data) setCustomers(qCustomers.data); }, [qCustomers.data]);
  useEffect(() => { if (qInvoices.data) setInvoices(qInvoices.data); }, [qInvoices.data]);
  useEffect(() => { if (qWarehouses.data) setWarehouses(qWarehouses.data); }, [qWarehouses.data]);
  useEffect(() => { if (qStocks.data) setStocks(qStocks.data); }, [qStocks.data]);
  useEffect(() => { if (qEmployees.data) setEmployees(qEmployees.data); }, [qEmployees.data]);
  useEffect(() => { if (qTasks.data) setTasks(qTasks.data); }, [qTasks.data]);

  // 打開編輯庫存弹窗時從 stocks 載入各倉庫當前 qty
  useEffect(() => {
    if (!editingProduct) { setEditStocks({}); return; }
    const init = {};
    for (const w of warehouses) {
      const row = stocks.find(s => s.product_id === editingProduct.id && s.warehouse_id === w.id);
      init[w.id] = row ? row.qty : 0;
    }
    setEditStocks(init);
  }, [editingProduct, warehouses, stocks]);

  // 最快一張到位就解 spinner
  useEffect(() => {
    if (qProducts.data || qInventory.data || qCustomers.data || qInvoices.data) setLoading(false);
  }, [qProducts.data, qInventory.data, qCustomers.data, qInvoices.data]);

  // 匯總錯誤
  useEffect(() => {
    const errs = [qProducts.error, qInventory.error, qCustomers.error, qInvoices.error].filter(Boolean);
    if (errs.length > 0) setLoadError(errs[0].message || String(errs[0]));
  }, [qProducts.error, qInventory.error, qCustomers.error, qInvoices.error]);

  // Realtime 訂閱 customers 表：INSERT/UPDATE/DELETE 時靜默刷新本地 state
  // 用途：Framer 意向表單寫入 Supabase 後前端自動同步，不用 F5
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel("customers-realtime")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "customers" }, (payload) => {
        const row = payload.new;
        if (!row) return;
        setCustomers(prev => prev.some(c => c.id === row.id) ? prev : [row, ...prev]);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "customers" }, (payload) => {
        const row = payload.new;
        if (!row) return;
        setCustomers(prev => prev.map(c => c.id === row.id ? row : c));
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "customers" }, (payload) => {
        const id = payload.old?.id;
        if (!id) return;
        setCustomers(prev => prev.filter(c => c.id !== id));
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId]);

  // 切到產品頁或點擊 Dashboard 庫存卡時，若有 SKU 庫存 <=0 自動彈右下角 toast
  useEffect(() => {
    if (tab !== "products") return;
    if (outOfStockSkus.length === 0) { setStockToast(null); return; }
    setStockToast({ items: outOfStockSkus.map(p => p.name) });
  }, [tab]); // 故意只監聽 tab —— outOfStockSkus 變動不重彈，避免騷擾

  // notes 里的 ISO 时间戳 (UTC) 自动转成 HK 时间显示
  const formatNotes = (notes) => {
    if (!notes) return "";
    return notes.replace(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z/g, (_, y, mo, d, h, mi) => {
      const utc = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi));
      const hk = new Date(utc.getTime() + 8 * 60 * 60 * 1000);
      const pad = (n) => String(n).padStart(2, "0");
      return `${hk.getUTCFullYear()}-${pad(hk.getUTCMonth() + 1)}-${pad(hk.getUTCDate())} ${pad(hk.getUTCHours())}:${pad(hk.getUTCMinutes())}`;
    });
  };

  const getProduct = (id) => products.find(p => p.id === id);
  const getCustomer = (id) => customers.find(c => c.id === id);
  const fmtInvNum = (inv) => {
    const num = String(inv.invoice_number || inv.id);
    return num.toUpperCase().startsWith("DC") ? num : `DC${num}`;
  };
  // 月營收（當月）
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const monthlyRevenue = useMemo(() => invoices.filter(i => (i.date || "").startsWith(currentMonth) && (i.status || "").trim().toLowerCase() === "paid").reduce((s, i) => s + (i.total || 0), 0), [invoices, currentMonth]);
  const totalRevenue = invoices.reduce((s, i) => s + (i.total || 0), 0);
  const inStock = inventory.filter(i => i.status === "In Stock").length;

  // 非保修項黑名單：運費 / 配件 / 費用類 不進保修提醒
  const isNonWarrantyItem = (name) => {
    if (!name) return true;
    const n = String(name).toLowerCase();
    return /運費|郵費|shipping|freight|防水盒|防水袋|押金|手續費/i.test(n);
  };

  // 保修提醒：從發票 + 產品 warranty_months 推算
  const warrantyItems = useMemo(() => {
    const today = new Date();
    const in30 = new Date(today); in30.setDate(in30.getDate() + 30);
    const results = [];
    for (const inv of invoices) {
      if (!Array.isArray(inv.items) || !inv.date) continue;
      const cust = customers.find(c => c.id === inv.customer_id);
      for (const item of inv.items) {
        if (isNonWarrantyItem(item.name)) continue;
        const prod = products.find(p => p.name === item.name);
        if (!prod || !prod.warranty_months) continue;
        const wEnd = new Date(inv.date);
        wEnd.setMonth(wEnd.getMonth() + prod.warranty_months);
        if (wEnd >= today && wEnd <= in30) {
          results.push({ customer: cust, customerName: cust?.name || "—", productName: item.name, invoiceNum: fmtInvNum(inv), invoiceDate: inv.date, warrantyEnd: wEnd.toISOString().slice(0, 10), daysLeft: Math.ceil((wEnd - today) / (1000 * 60 * 60 * 24)) });
        }
      }
    }
    return results.sort((a, b) => {
      if (!!a.customer !== !!b.customer) return a.customer ? -1 : 1;
      return a.daysLeft - b.daysLeft;
    });
  }, [invoices, products, customers]);
  const warrantyAlerts = warrantyItems;

  // 庫存不足 SKU（活 SKU + 非父 + 所有倉庫合計 <= 0）
  const outOfStockSkus = useMemo(() => {
    if (!products.length) return [];
    const parentIds = new Set(products.filter(x => x.parent_product_id).map(x => x.parent_product_id));
    const byProd = new Map();
    for (const s of stocks) {
      byProd.set(s.product_id, (byProd.get(s.product_id) || 0) + (s.qty || 0));
    }
    return products.filter(p => {
      if (p.category === '_archived') return false;
      if (parentIds.has(p.id)) return false;
      return (byProd.get(p.id) || 0) <= 0;
    });
  }, [products, stocks]);

  // 全量保修條目：涵蓋過期 30 天內 + 未來 365 天內，用於獨立「保修」tab
  // 僅顯示有客戶記錄的，無名客戶排除（無法聯繫不顯示）
  const allWarrantyItems = useMemo(() => {
    const today = new Date();
    const expiredCutoff = new Date(today); expiredCutoff.setDate(expiredCutoff.getDate() - 30);
    const upcomingCutoff = new Date(today); upcomingCutoff.setDate(upcomingCutoff.getDate() + 365);
    const results = [];
    for (const inv of invoices) {
      if (!Array.isArray(inv.items) || !inv.date) continue;
      const cust = customers.find(c => c.id === inv.customer_id);
      if (!cust) continue;
      for (const item of inv.items) {
        if (isNonWarrantyItem(item.name)) continue;
        const prod = products.find(p => p.name === item.name);
        if (!prod || !prod.warranty_months) continue;
        const wEnd = new Date(inv.date);
        wEnd.setMonth(wEnd.getMonth() + prod.warranty_months);
        if (wEnd >= expiredCutoff && wEnd <= upcomingCutoff) {
          const daysLeft = Math.ceil((wEnd - today) / (1000 * 60 * 60 * 24));
          let bucket;
          if (daysLeft < 0) bucket = "expired";
          else if (daysLeft <= 7) bucket = "week";
          else if (daysLeft <= 30) bucket = "soon";
          else if (daysLeft <= 90) bucket = "near";
          else bucket = "far";
          results.push({
            customer: cust,
            customerName: cust.name || "—",
            customerPhone: cust.phone || "",
            productName: item.name,
            invoiceNum: fmtInvNum(inv),
            invoiceId: inv.id,
            invoiceDate: inv.date,
            warrantyEnd: wEnd.toISOString().slice(0, 10),
            daysLeft,
            bucket,
          });
        }
      }
    }
    return results.sort((a, b) => a.daysLeft - b.daysLeft);
  }, [invoices, products, customers]);

  // 從發票反推庫存：按產品聚合已售數量
  const derivedInventory = useMemo(() => {
    const map = {};
    for (const inv of invoices) {
      if (!Array.isArray(inv.items)) continue;
      const cust = customers.find(c => c.id === inv.customer_id);
      for (const item of inv.items) {
        const prod = products.find(p => p.name === item.name);
        const key = item.name;
        if (!map[key]) map[key] = { productName: key, productId: prod?.id, totalSold: 0, stock: prod?.stock ?? 0, warrantyMonths: prod?.warranty_months, records: [] };
        map[key].totalSold += (item.qty || 1);
        map[key].records.push({ customerName: cust?.name || "—", date: inv.date, qty: item.qty || 1, invoiceNum: fmtInvNum(inv) });
      }
    }
    const values = Object.values(map);
    for (const v of values) v.stock = Math.max((v.stock || 0) - v.totalSold, 0);
    return values.sort((a, b) => b.totalSold - a.totalSold);
  }, [invoices, products, customers]);

  const extrasTotal =
    (newInvoice.deposit?.enabled ? (Number(newInvoice.deposit.amount) || 0) : 0) +
    (newInvoice.surcharge?.enabled ? (Number(newInvoice.surcharge.amount) || 0) : 0) -
    (newInvoice.discount?.enabled ? (Number(newInvoice.discount.amount) || 0) : 0);
  const invoiceTotal = newInvoice.items.reduce((sum, item) => sum + (item.price * item.qty || 0), 0) + extrasTotal;

  const navItems = [
    { id: "dashboard", label: "總覽", icon: "dashboard" },
    { id: "products", label: "產品", icon: "product" },
    { id: "customers", label: "客戶", icon: "customer" },
    { id: "invoices", label: "發票", icon: "invoice" },
    { id: "warranty", label: "保修", icon: "warning" },
    { id: "revenue", label: "營收", icon: "trend_up" },
    { id: "employees", label: "員工管理", icon: "customer" },
  ];

  async function handleSaveCustomer() {
    setSaving(true);
    const { data, error } = await supabase.from("customers").insert([{
      name: newCustomer.name,
      email: newCustomer.email,
      phone: newCustomer.phone,
      phone_mainland: newCustomer.phone_mainland,
      car_make: newCustomer.car_make,
      car_model: newCustomer.car_model,
      address: newCustomer.address,
      interest_products: newCustomer.interest_products,
      referral: newCustomer.referral,
      type: newCustomer.type || "Lead",
      notes: newCustomer.notes,
    }]).select();
    if (!error && data) {
      setCustomers(prev => [...prev, ...data]);
      setShowAddCustomer(false);
      setNewCustomer({ name: "", email: "", phone: "", phone_mainland: "", car_make: "", car_model: "", address: "", interest_products: [], referral: "", type: "Lead", notes: "" });
    } else if (error) {
      alert(`新增客戶失敗：${error.message}`);
    }
    setSaving(false);
  }

  async function handleGenerateInvoice() {
    setSaving(true);
    const invNumber = `${Date.now()}`.slice(-6);
    const finalItems = [...newInvoice.items];
    if (newInvoice.deposit?.enabled && Number(newInvoice.deposit.amount)) {
      finalItems.push({ id: mkItem().id, name: "押金", qty: 1, price: Number(newInvoice.deposit.amount) });
    }
    if (newInvoice.surcharge?.enabled && Number(newInvoice.surcharge.amount)) {
      finalItems.push({ id: mkItem().id, name: "手續費", qty: 1, price: Number(newInvoice.surcharge.amount) });
    }
    if (newInvoice.discount?.enabled && Number(newInvoice.discount.amount)) {
      finalItems.push({ id: mkItem().id, name: "優惠", qty: 1, price: -Number(newInvoice.discount.amount) });
    }
    const { data, error } = await supabase.from("invoices").insert([{
      invoice_number: invNumber,
      customer_id: newInvoice.customerId || null,
      date: new Date().toISOString().slice(0, 10),
      items: finalItems,
      total: invoiceTotal,
      status: "Unpaid",
      notes: newInvoice.notes,
    }]).select();
    if (!error && data) {
      setInvoices(prev => [data[0], ...prev]);
      setInvoiceGenerated(true);
      const customer = getCustomer(newInvoice.customerId);
      // 把弹窗里勾选的多值字段 override 进 customer，跳过再弹信息选择 modal
      const gid = customerGroups.idToGroup.get(newInvoice.customerId);
      const virtual = gid ? customerGroups.virtualCustomers.find(v => v.id === gid) : null;
      const effective = { ...(virtual || customer), ...(newInvoice.fieldOverrides || {}) };
      enterPrintFlow(data[0], effective, finalItems, products);

      // Auto-create warranty: update inventory items with warranty_end dates
      const invoiceDate = new Date();
      for (const item of newInvoice.items) {
        const matchedProduct = products.find(p => p.name === item.name);
        if (matchedProduct && matchedProduct.warranty_months) {
          const warrantyEnd = new Date(invoiceDate);
          warrantyEnd.setMonth(warrantyEnd.getMonth() + matchedProduct.warranty_months);
          const warrantyEndStr = warrantyEnd.toISOString().slice(0, 10);
          const matchingInventory = inventory.filter(
            inv => inv.product_id === matchedProduct.id && inv.status === "In Stock"
          );
          for (const invItem of matchingInventory.slice(0, item.qty)) {
            const { error: invErr } = await supabase.from("inventory").update({
              status: "Sold",
              customer_id: newInvoice.customerId || null,
              sold_date: invoiceDate.toISOString().slice(0, 10),
              warranty_end: warrantyEndStr,
              invoice_id: data[0].id,
            }).eq("id", invItem.id);
            if (invErr) {
              console.error(`庫存更新失敗 (item ${invItem.id}):`, invErr);
              alert(`發票已生成 (#${data[0].invoice_number})，但部分庫存更新失敗：${invErr.message}\n請在庫存頁手動核對。`);
              continue;
            }
            setInventory(prev => prev.map(i =>
              i.id === invItem.id ? { ...i, status: "Sold", customer_id: newInvoice.customerId || null, sold_date: invoiceDate.toISOString().slice(0, 10), warranty_end: warrantyEndStr, invoice_id: data[0].id } : i
            ));
          }
        }
      }

      setTimeout(() => {
        setInvoiceGenerated(false);
        closeNewInvoice();
      }, 2000);
    } else if (error) {
      alert(`發票生成失敗：${error.message}`);
    }
    setSaving(false);
  }

  function openEditInvoice(inv) {
    const rawItems = Array.isArray(inv.items) ? inv.items : (() => { try { return JSON.parse(inv.items || "[]"); } catch { return []; } })();
    // 拆分：押金/優惠/手續費 line item 提取出來作為 extras，其他進明細
    const extras = { deposit: { enabled: false, amount: 0 }, discount: { enabled: false, amount: 0 }, surcharge: { enabled: false, amount: 0 } };
    const normalItems = [];
    for (const it of rawItems) {
      const name = (it.name || "").trim();
      const p = Number(it.price) || 0;
      if (name === "押金") { extras.deposit = { enabled: true, amount: p }; continue; }
      if (name === "優惠") { extras.discount = { enabled: true, amount: Math.abs(p) }; continue; }
      if (name === "手續費") { extras.surcharge = { enabled: true, amount: p }; continue; }
      normalItems.push({ id: it.id || mkItem().id, name, qty: Number(it.qty) || 1, price: p });
    }
    setEditingInvoice(inv);
    setEditInvItems(normalItems.length > 0 ? normalItems : [mkItem()]);
    setEditInvExtras(extras);
    setEditInvTotalOverride("");
  }
  function closeEditInvoice() {
    setEditingInvoice(null);
    setEditInvItems([]);
    setEditInvTotalOverride("");
    setEditInvExtras({ deposit: { enabled: false, amount: 0 }, discount: { enabled: false, amount: 0 }, surcharge: { enabled: false, amount: 0 } });
  }
  async function handleSaveInvoice() {
    if (!editingInvoice) return;
    // 組裝最終 items：普通明細 + 勾選的 extras 作為 line item
    const cleanItems = editInvItems.filter(it => it.name || it.qty || it.price);
    const finalItems = [...cleanItems];
    if (editInvExtras.deposit?.enabled && Number(editInvExtras.deposit.amount)) {
      finalItems.push({ id: mkItem().id, name: "押金", qty: 1, price: Number(editInvExtras.deposit.amount) });
    }
    if (editInvExtras.surcharge?.enabled && Number(editInvExtras.surcharge.amount)) {
      finalItems.push({ id: mkItem().id, name: "手續費", qty: 1, price: Number(editInvExtras.surcharge.amount) });
    }
    if (editInvExtras.discount?.enabled && Number(editInvExtras.discount.amount)) {
      finalItems.push({ id: mkItem().id, name: "優惠", qty: 1, price: -Number(editInvExtras.discount.amount) });
    }
    const itemsSum = finalItems.reduce((s, it) => s + (Number(it.price) || 0) * (Number(it.qty) || 0), 0);
    const finalTotal = editInvTotalOverride === "" ? itemsSum : (Number(editInvTotalOverride) || 0);
    const { error } = await supabase.from("invoices").update({ items: finalItems, total: finalTotal }).eq("id", editingInvoice.id);
    if (error) { alert(`儲存失敗：${error.message}`); return; }
    setInvoices(prev => prev.map(i => i.id === editingInvoice.id ? { ...i, items: finalItems, total: finalTotal } : i));
    closeEditInvoice();
  }

  function handleMarkPaid(inv) {
    if ((inv.status || "").trim().toLowerCase() === "paid") return;
    setMarkPaidCtx({ inv, defaultWh: warehouses[0]?.id || null });
  }

  // 解析發票 items 成扣減計劃（item + product + warehouse_id + 當前庫存 + 扣後庫存）
  function buildDeductionPlan(inv, defaultWh) {
    let itemsArr = inv.items;
    if (typeof itemsArr === "string") { try { itemsArr = JSON.parse(itemsArr); } catch { itemsArr = []; } }
    if (!Array.isArray(itemsArr)) itemsArr = [];
    const parentIds = new Set(products.filter(x => x.parent_product_id).map(x => x.parent_product_id));
    const plan = [];
    for (const it of itemsArr) {
      const prod = products.find(p => p.name === it.name);
      if (!prod) { plan.push({ name: it.name, qty: Number(it.qty) || 0, skip: true, reason: "產品未匹配" }); continue; }
      if (prod.category === '_archived') { plan.push({ name: it.name, qty: Number(it.qty) || 0, skip: true, reason: "已歸檔老產品" }); continue; }
      if (parentIds.has(prod.id)) { plan.push({ name: it.name, qty: Number(it.qty) || 0, skip: true, reason: "父 SKU 不扣" }); continue; }
      const wid = it.warehouse_id || defaultWh;
      if (!wid) { plan.push({ name: it.name, qty: Number(it.qty) || 0, skip: true, reason: "無倉庫" }); continue; }
      const stock = stocks.find(s => s.product_id === prod.id && s.warehouse_id === wid);
      const current = stock?.qty || 0;
      const deduct = Number(it.qty) || 0;
      plan.push({ product_id: prod.id, warehouse_id: wid, name: it.name, qty: deduct, current, after: current - deduct });
    }
    return plan;
  }

  async function executeMarkPaid() {
    if (!markPaidCtx) return;
    const { inv, defaultWh } = markPaidCtx;
    const plan = buildDeductionPlan(inv, defaultWh);
    const deductions = plan.filter(p => !p.skip && p.qty > 0);
    // 扣減 + 流水
    for (const d of deductions) {
      await supabase.from("inventory_stock").upsert({
        product_id: d.product_id,
        warehouse_id: d.warehouse_id,
        qty: d.after,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'product_id,warehouse_id' });
      await supabase.from("inventory_movements").insert({
        product_id: d.product_id,
        warehouse_id: d.warehouse_id,
        delta: -d.qty,
        type: 'sale',
        reason: `發票 #${inv.invoice_number || inv.id} 標記已付款`,
        invoice_id: inv.id,
      });
    }
    const { error } = await supabase.from("invoices").update({ status: "Paid" }).eq("id", inv.id);
    if (error) { alert(`標記失敗：${error.message}`); return; }
    setInvoices(prev => prev.map(i => i.id === inv.id ? { ...i, status: "Paid" } : i));
    setStocks(prev => {
      const map = new Map(prev.map(s => [`${s.product_id}|${s.warehouse_id}`, s]));
      for (const d of deductions) {
        const k = `${d.product_id}|${d.warehouse_id}`;
        const existing = map.get(k);
        map.set(k, existing ? { ...existing, qty: d.after } : { product_id: d.product_id, warehouse_id: d.warehouse_id, qty: d.after });
      }
      return [...map.values()];
    });
    setMarkPaidCtx(null);
  }

  async function handleDeleteCustomer(c) {
    const cids = c.allCids || c.groupCids || [c.id];
    const invCount = invoices.filter(i => cids.includes(i.customer_id)).length;
    if (invCount > 0) {
      alert(`此客戶有 ${invCount} 張發票，請先刪除該客戶的所有發票，再刪除客戶。`);
      return;
    }
    const msg = cids.length > 1
      ? `確定刪除客戶「${c.name || "(無名)"}」及其合併的 ${cids.length} 條重複記錄？\n\n此操作不可撤銷。`
      : `確定刪除客戶「${c.name || "(無名)"}」？\n\n此操作不可撤銷。`;
    const confirmed = window.confirm(msg);
    if (!confirmed) return;
    const { error } = await supabase.from("customers").delete().in("id", cids);
    if (error) { alert(`刪除客戶失敗：${error.message}`); return; }
    setCustomers(prev => prev.filter(x => !cids.includes(x.id)));
    setSelectedCustomer(null);
  }

  async function handleDeleteInvoice(inv) {
    const cust = customers.find(c => c.id === inv.customer_id);
    const custLine = cust ? (cust.name || "(無名)") + (cust.phone ? ` · ${cust.phone}` : "") : "(無客戶)";
    let itemsArr = inv.items;
    if (typeof itemsArr === "string") { try { itemsArr = JSON.parse(itemsArr); } catch { itemsArr = []; } }
    if (!Array.isArray(itemsArr)) itemsArr = [];
    const itemsLine = itemsArr.length > 0
      ? itemsArr.map(it => `  • ${it.name || "(未命名)"} × ${it.qty || 1}`).join("\n")
      : "  (無明細)";
    const msg =
      `⚠️ 確認刪除以下發票？\n\n` +
      `發票號：DC${String(inv.invoice_number || inv.id).replace(/^DC/i, "")}\n` +
      `客戶：${custLine}\n` +
      `日期：${inv.date || "-"}\n` +
      `金額：HKD$${inv.total || 0}\n` +
      `狀態：${inv.status || "-"}\n` +
      `明細：\n${itemsLine}\n\n` +
      `此操作會同時還原對應的庫存狀態（Sold → In Stock），不可撤銷。`;
    const confirmed = window.confirm(msg);
    if (!confirmed) return;
    const { data: relatedInv, error: fetchErr } = await supabase
      .from("inventory").select("id").eq("invoice_id", inv.id);
    if (fetchErr) { alert(`查詢關聯庫存失敗：${fetchErr.message}`); return; }
    if (relatedInv && relatedInv.length > 0) {
      const { error: restoreErr } = await supabase.from("inventory")
        .update({ status: "In Stock", customer_id: null, sold_date: null, warranty_end: null, invoice_id: null })
        .eq("invoice_id", inv.id);
      if (restoreErr) { alert(`還原庫存失敗：${restoreErr.message}`); return; }
    }
    const { error: delErr } = await supabase.from("invoices").delete().eq("id", inv.id);
    if (delErr) { alert(`刪除發票失敗：${delErr.message}`); return; }
    setInvoices(prev => prev.filter(i => i.id !== inv.id));
    if (relatedInv && relatedInv.length > 0) {
      const ids = new Set(relatedInv.map(r => r.id));
      setInventory(prev => prev.map(i => ids.has(i.id)
        ? { ...i, status: "In Stock", customer_id: null, sold_date: null, warranty_end: null, invoice_id: null }
        : i));
    }
  }

  // ── 員工管理 ──────────────────────────────────────────────
  async function handleSaveEmployee() {
    if (!newEmployee.name.trim()) { alert("請輸入員工姓名"); return; }
    const { data, error } = await supabase.from("employees").insert({
      name: newEmployee.name.trim(),
      role: newEmployee.role.trim() || null,
      phone: newEmployee.phone.trim() || null,
      email: newEmployee.email.trim() || null,
      note: newEmployee.note.trim() || null,
    }).select().single();
    if (error) { alert(`新增失敗：${error.message}`); return; }
    setEmployees(prev => [...prev, data]);
    setShowAddEmployee(false);
    setNewEmployee({ name: "", role: "", phone: "", email: "", note: "" });
  }

  async function handleDeleteEmployee(emp) {
    const taskCount = tasks.filter(t => t.employee_id === emp.id).length;
    const msg = taskCount > 0
      ? `確定刪除員工「${emp.name}」？\n將同時刪除其 ${taskCount} 條任務記錄。此操作不可撤銷。`
      : `確定刪除員工「${emp.name}」？此操作不可撤銷。`;
    if (!window.confirm(msg)) return;
    const { error } = await supabase.from("employees").delete().eq("id", emp.id);
    if (error) { alert(`刪除失敗：${error.message}`); return; }
    setEmployees(prev => prev.filter(e => e.id !== emp.id));
    setTasks(prev => prev.filter(t => t.employee_id !== emp.id));
    setSelectedEmployee(null);
  }

  async function handleAddTask(employeeId, title, priority = "none", parentTaskId = null) {
    if (!title || !title.trim()) return;
    const { data, error } = await supabase.from("employee_tasks").insert({
      employee_id: employeeId,
      title: title.trim(),
      priority,
      parent_task_id: parentTaskId,
    }).select().single();
    if (error) { alert(`新增任務失敗：${error.message}`); return; }
    setTasks(prev => [...prev, data]);
    return data;
  }

  async function handleUpdateTask(taskId, patch) {
    const { error } = await supabase.from("employee_tasks").update(patch).eq("id", taskId);
    if (error) { alert(`更新失敗：${error.message}`); return; }
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, ...patch } : t));
    if (editingTask?.id === taskId) setEditingTask(prev => ({ ...prev, ...patch }));
  }

  async function handleToggleTaskDone(task) {
    const next = task.status === "done" ? "open" : "done";
    await handleUpdateTask(task.id, { status: next, completed_at: next === "done" ? new Date().toISOString() : null });
  }

  async function handleDeleteTask(taskId) {
    if (!window.confirm("確定刪除此任務及所有子任務？")) return;
    const { error } = await supabase.from("employee_tasks").delete().eq("id", taskId);
    if (error) { alert(`刪除失敗：${error.message}`); return; }
    setTasks(prev => prev.filter(t => t.id !== taskId && t.parent_task_id !== taskId));
    if (editingTask?.id === taskId) setEditingTask(null);
  }

  // 認證載入中（Supabase 正在讀 session）
  if (authLoading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#f7f8fc" }}>
      <div style={{ width: 40, height: 40, border: "4px solid #e0e0e0", borderTopColor: "#6382ff", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  // 未登入 → 顯示登入頁
  if (!session) {
    const tryLogin = async () => {
      if (!loginEmail || !loginPw) { setLoginError("請輸入郵箱和密碼"); return; }
      setLoginBusy(true);
      setLoginError("");
      const { error } = await supabase.auth.signInWithPassword({ email: loginEmail, password: loginPw });
      if (error) setLoginError(error.message || "登入失敗");
      setLoginBusy(false);
    };
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "linear-gradient(135deg,#1a1f3a,#2d3561)" }}>
        <div style={{ background: "#fff", borderRadius: 16, padding: 40, width: 380, boxShadow: "0 10px 40px rgba(0,0,0,0.2)" }}>
          <div style={{ textAlign: "center", marginBottom: 28 }}>
            <div style={{ width: 56, height: 56, margin: "0 auto 14px", borderRadius: "50%", background: "linear-gradient(135deg,#6382ff,#a78bfa)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, fontWeight: 800, color: "#fff" }}>H</div>
            <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>Honnmono BizFlow</h2>
            <p style={{ margin: "6px 0 0", fontSize: 13, color: "#888" }}>管理員登入</p>
          </div>
          <input
            type="email"
            autoFocus
            value={loginEmail}
            onChange={e => { setLoginEmail(e.target.value); setLoginError(""); }}
            onKeyDown={e => { if (e.key === "Enter") tryLogin(); }}
            placeholder="郵箱"
            disabled={loginBusy}
            style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: "1px solid #e0e0e0", fontSize: 15, outline: "none", boxSizing: "border-box", marginBottom: 10 }}
          />
          <input
            type="password"
            value={loginPw}
            onChange={e => { setLoginPw(e.target.value); setLoginError(""); }}
            onKeyDown={e => { if (e.key === "Enter") tryLogin(); }}
            placeholder="密碼"
            disabled={loginBusy}
            style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: loginError ? "1px solid #ef4444" : "1px solid #e0e0e0", fontSize: 15, outline: "none", boxSizing: "border-box", marginBottom: 8 }}
          />
          {loginError && <div style={{ color: "#ef4444", fontSize: 13, marginBottom: 8 }}>{loginError}</div>}
          <button onClick={tryLogin} disabled={loginBusy} style={{ width: "100%", padding: 12, background: loginBusy ? "#b0c0ff" : "#6382ff", color: "#fff", border: "none", borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: loginBusy ? "wait" : "pointer", marginTop: 8 }}>
            {loginBusy ? "登入中..." : "登入"}
          </button>
        </div>
      </div>
    );
  }

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", flexDirection: "column", gap: 16, background: "#f7f8fc" }}>
      <div style={{ width: 48, height: 48, border: "4px solid #e0e0e0", borderTopColor: "#6382ff", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <div style={{ color: "#888", fontSize: 15 }}>正在載入 BizFlow...</div>
    </div>
  );

  if (loadError) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", flexDirection: "column", gap: 16, background: "#f7f8fc", padding: 40 }}>
      <div style={{ fontSize: 48 }}>⚠️</div>
      <div style={{ color: "#d32f2f", fontSize: 18, fontWeight: 700 }}>資料載入失敗</div>
      <div style={{ color: "#666", fontSize: 13, maxWidth: 500, textAlign: "center", wordBreak: "break-all" }}>{loadError}</div>
      <button onClick={() => window.location.reload()} style={{ padding: "10px 24px", background: "#6382ff", color: "#fff", border: "none", borderRadius: 8, fontSize: 14, cursor: "pointer" }}>重新載入</button>
    </div>
  );

  return (
    <div style={{ display: "flex", height: "100vh", fontFamily: "'DM Sans','Helvetica Neue',sans-serif", background: "#f7f8fc", color: "#1a1a2e" }}>

      {/* SIDEBAR */}
      <aside style={{ width: 220, background: "#1a1a2e", display: "flex", flexDirection: "column", flexShrink: 0 }}>
        <div style={{ padding: "20px 18px", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
          <img src={`data:image/png;base64,${LOGO_B64}`} style={{ width: "100%", maxHeight: 36, objectFit: "contain", filter: "invert(1)" }} />
          <div style={{ fontSize: 10, color: "#6b7bb8", marginTop: 6, letterSpacing: "0.1em", textTransform: "uppercase" }}>業務管理系統</div>
        </div>
        {warrantyAlerts.length > 0 && (
          <div onClick={() => setTab("warranty")} style={{ margin: "10px 12px", background: "#ff9800", borderRadius: 10, padding: "8px 12px", display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <Icon name="warning" size={13} />
            <div style={{ color: "#fff", fontSize: 12, fontWeight: 600 }}>{warrantyAlerts.length} 件保修即將到期</div>
          </div>
        )}
        <nav style={{ flex: 1, padding: "10px 8px", display: "flex", flexDirection: "column", gap: 2 }}>
          {navItems.map(n => (
            <button key={n.id} onClick={() => { setTab(n.id); setSelectedCustomer(null); setSearch(""); setVisibleCustomers(30); setVisibleInvoices(30); }} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 14px", borderRadius: 10, border: "none", cursor: "pointer", background: tab === n.id ? "rgba(99,130,255,0.18)" : "transparent", color: tab === n.id ? "#7c9dff" : "#8899cc", fontSize: 14, fontWeight: tab === n.id ? 700 : 500, textAlign: "left" }}>
              <Icon name={n.icon} size={17} />{n.label}
            </button>
          ))}
        </nav>
        <div style={{ padding: "14px 12px", borderTop: "1px solid rgba(255,255,255,0.07)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", background: "rgba(99,130,255,0.1)", borderRadius: 10 }}>
            <div style={{ width: 30, height: 30, borderRadius: "50%", background: "linear-gradient(135deg,#7c9dff,#a78bfa)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "#fff" }}>H</div>
            <div style={{ flex: 1, overflow: "hidden" }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{session?.user?.email || "Honnmono"}</div>
              <div style={{ fontSize: 11, color: "#6b7bb8" }}>管理員</div>
            </div>
            <button
              onClick={async () => { await supabase.auth.signOut(); }}
              title="登出"
              style={{ background: "none", border: "none", color: "#6b7bb8", cursor: "pointer", padding: 4, fontSize: 16 }}
            >⎋</button>
          </div>
        </div>
      </aside>

      {/* MAIN */}
      <main style={{ flex: 1, overflow: "auto", padding: "32px 36px" }}>

        {/* DASHBOARD */}
        {tab === "dashboard" && (
          <div>
            <div style={{ marginBottom: 28 }}>
              <h1 style={{ fontSize: 26, fontWeight: 800, margin: 0 }}>早安 👋</h1>
              <p style={{ color: "#888", margin: "4px 0 0", fontSize: 15 }}>以下是 Honnmono 今日的業務概況。</p>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 28 }}>
              <StatCard label="本月營收" value={`HKD$${monthlyRevenue.toLocaleString()}`} sub={`${now.getFullYear()}年${now.getMonth() + 1}月`} accent="#6382ff" icon={<Icon name="trend_up" size={20} />} onClick={() => setTab("revenue")} />
              <StatCard label="庫存數量" value={inStock} sub={`共 ${inventory.length} 件`} accent="#22c55e" icon={<Icon name="inventory" size={20} />} onClick={() => setTab("products")} />
              <StatCard label="客戶數" value={customers.length} sub="累計" accent="#f59e0b" icon={<Icon name="customer" size={20} />} onClick={() => { setTab("customers"); setSelectedCustomer(null); }} />
              <StatCard label="保修提醒" value={warrantyAlerts.length} sub="需跟進" accent="#ef4444" icon={<Icon name="warning" size={20} />} onClick={() => setTab("warranty")} />
            </div>
            <div style={{ position: "relative", marginBottom: 20 }}>
              <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #f0f0f0", padding: "10px 14px", display: "flex", alignItems: "center", gap: 8 }}>
                <Icon name="search" size={15} />
                <input placeholder="搜尋發票、客戶、產品..." value={dashSearch} onChange={e => setDashSearch(e.target.value)} style={{ border: "none", background: "none", outline: "none", fontSize: 14, width: "100%" }} />
                {dashSearch && (
                  <button onClick={() => setDashSearch("")} style={{ background: "#f5f5f5", border: "none", borderRadius: 6, padding: "4px 8px", cursor: "pointer", fontSize: 12, color: "#666" }}>×</button>
                )}
              </div>
              {dashSearch.trim() && (() => {
                const q = dashSearch.trim().toLowerCase();
                const custMatches = customerGroups.virtualCustomers.filter(c =>
                  c.allNames.some(n => n.toLowerCase().includes(q))
                  || c.allPhones.some(p => p.toLowerCase().includes(q))
                  || c.allEmails.some(e => e.toLowerCase().includes(q))
                  || (c.car_make || "").toLowerCase().includes(q)
                  || (c.car_model || "").toLowerCase().includes(q)
                ).slice(0, 5);
                const prodMatches = products.filter(p => (p.name || "").toLowerCase().includes(q)).slice(0, 5);
                const invMatches = invoices.filter(inv => {
                  const c = getCustomer(inv.customer_id);
                  return String(inv.invoice_number || "").toLowerCase().includes(q)
                    || (c?.name || "").toLowerCase().includes(q)
                    || (inv.notes || "").toLowerCase().includes(q);
                }).slice(0, 5);
                const total = custMatches.length + prodMatches.length + invMatches.length;
                const panelStyle = { position: "absolute", top: "100%", left: 0, right: 0, background: "#fff", border: "1px solid #e0e0e0", borderRadius: 12, marginTop: 4, boxShadow: "0 8px 28px rgba(0,0,0,0.1)", zIndex: 20, maxHeight: 500, overflowY: "auto" };
                const hdrStyle = { padding: "10px 16px 4px", fontSize: 11, fontWeight: 700, color: "#888", letterSpacing: "0.08em", textTransform: "uppercase", background: "#fafbff" };
                const rowStyle = { padding: "10px 16px", cursor: "pointer", display: "flex", alignItems: "center", gap: 12, borderBottom: "1px solid #f5f5f5" };
                if (total === 0) return (<div style={{ ...panelStyle, padding: 20, textAlign: "center", color: "#999", fontSize: 13 }}>沒有符合的結果</div>);
                return (
                  <div style={panelStyle}>
                    {custMatches.length > 0 && <>
                      <div style={hdrStyle}>客戶（{custMatches.length}）</div>
                      {custMatches.map(c => (
                        <div key={"c" + c.id} onClick={() => { setTab("customers"); setSelectedCustomer(c); setDashSearch(""); }} style={rowStyle} onMouseEnter={e => e.currentTarget.style.background = "#f7f8fc"} onMouseLeave={e => e.currentTarget.style.background = "#fff"}>
                          <div style={{ width: 32, height: 32, borderRadius: "50%", background: "linear-gradient(135deg,#6382ff,#a78bfa)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "#fff", flexShrink: 0 }}>{(c.name || "?")[0]}</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 700, fontSize: 13 }}>{c.name}</div>
                            <div style={{ fontSize: 11, color: "#888", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{[c.phone, c.email].filter(Boolean).join(" · ")}{c.car_make ? ` · 🚗 ${c.car_make} ${c.car_model || ""}` : ""}</div>
                          </div>
                        </div>
                      ))}
                    </>}
                    {prodMatches.length > 0 && <>
                      <div style={hdrStyle}>產品（{prodMatches.length}）</div>
                      {prodMatches.map(p => (
                        <div key={"p" + p.id} onClick={() => { setTab("products"); setDashSearch(""); }} style={rowStyle} onMouseEnter={e => e.currentTarget.style.background = "#f7f8fc"} onMouseLeave={e => e.currentTarget.style.background = "#fff"}>
                          <div style={{ fontSize: 20, width: 32, textAlign: "center" }}>📦</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 700, fontSize: 13 }}>{p.name}</div>
                            <div style={{ fontSize: 11, color: "#888" }}>HKD${p.price} · 保修 {p.warranty_months || "—"} 月</div>
                          </div>
                        </div>
                      ))}
                    </>}
                    {invMatches.length > 0 && <>
                      <div style={hdrStyle}>發票（{invMatches.length}）</div>
                      {invMatches.map(inv => {
                        const c = getCustomer(inv.customer_id);
                        return (
                          <div key={"i" + inv.id} onClick={() => { setTab("invoices"); setSearch(String(inv.invoice_number || inv.id).replace(/^DC/i, "")); setDashSearch(""); }} style={rowStyle} onMouseEnter={e => e.currentTarget.style.background = "#f7f8fc"} onMouseLeave={e => e.currentTarget.style.background = "#fff"}>
                            <div style={{ fontSize: 20, width: 32, textAlign: "center" }}>📄</div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontWeight: 700, fontSize: 13 }}>{fmtInvNum(inv)}</div>
                              <div style={{ fontSize: 11, color: "#888", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c?.name || "—"} · {inv.date || "?"} · HKD${inv.total}</div>
                            </div>
                            <Badge status={inv.status} />
                          </div>
                        );
                      })}
                    </>}
                  </div>
                );
              })()}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
              <div style={{ background: "#fff", borderRadius: 16, padding: 24, border: "1px solid #f0f0f0", boxShadow: "0 2px 12px rgba(0,0,0,0.04)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                  <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>最近發票</h2>
                  <button onClick={() => setTab("invoices")} style={{ fontSize: 13, color: "#6382ff", background: "none", border: "none", cursor: "pointer", fontWeight: 600 }}>查看全部 →</button>
                </div>
                {invoices.slice(0, 5).map(inv => {
                  const c = getCustomer(inv.customer_id);
                  return (
                    <div key={inv.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 0", borderBottom: "1px solid #f5f5f5" }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>{fmtInvNum(inv)}</div>
                        <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>{(c?.phone || c?.phone_mainland) ? `${c.phone || c.phone_mainland} · ` : ""}{c?.name || "—"} · {inv.date || "日期未知"}</div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <span style={{ fontWeight: 700, fontSize: 15 }}>HKD${inv.total}</span>
                        <Badge status={inv.status} />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{ background: "#fff", borderRadius: 16, padding: 24, border: "1px solid #f0f0f0", boxShadow: "0 2px 12px rgba(0,0,0,0.04)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                  <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>🔔 保修提醒</h2>
                  <Badge status="Warranty Expiring" />
                </div>
                {warrantyItems.length === 0 ? (
                  <div style={{ color: "#aaa", fontSize: 14, textAlign: "center", paddingTop: 20 }}>目前沒有提醒 ✓</div>
                ) : <>{warrantyItems.slice(0, 5).map((item, idx) => (
                    <div key={idx} onClick={() => { if (item.customer) { setTab("customers"); setSelectedCustomer(item.customer); } }} style={{ background: "#fff8f0", border: "1px solid #ffe0b2", borderRadius: 12, padding: "12px 16px", marginBottom: 10, cursor: item.customer ? "pointer" : "default", transition: "all 0.15s" }}
                      onMouseEnter={e => { if (item.customer) { e.currentTarget.style.borderColor = "#ff9800"; e.currentTarget.style.background = "#fff3e0"; } }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = "#ffe0b2"; e.currentTarget.style.background = "#fff8f0"; }}>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{item.productName}</div>
                      <div style={{ fontSize: 12, color: "#666", marginTop: 3 }}>{item.customerName} · {item.invoiceNum}</div>
                      <div style={{ fontSize: 12, color: "#e65100", marginTop: 4, fontWeight: 600 }}>保修到期：{item.warrantyEnd}（剩餘 {item.daysLeft} 天）</div>
                    </div>
                ))}
                {warrantyItems.length > 5 && (
                  <button onClick={() => setTab("warranty")} style={{ display: "block", margin: "8px auto 0", padding: "8px 20px", background: "#fff3e0", color: "#ff9800", border: "1px solid #ffe0b2", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 13 }}>
                    查看全部保修記錄 →
                  </button>
                )}</>}
              </div>
            </div>
          </div>
        )}

        {/* INVENTORY */}
        {/* PRODUCTS (合并庫存) */}
        {tab === "products" && !selectedProduct && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
              <div>
                <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>產品</h1>
                <p style={{ color: "#888", margin: "4px 0 0", fontSize: 14 }}>產品目錄 + 庫存管理</p>
              </div>
            </div>
            <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #f0f0f0", padding: "10px 14px", marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
              <Icon name="search" size={15} />
              <input placeholder="搜尋和篩選..." value={search} onChange={e => setSearch(e.target.value)} style={{ border: "none", background: "none", outline: "none", fontSize: 14, width: "100%" }} />
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
              {(() => {
                const cats = [...new Set(products.filter(p => !p.parent_product_id && p.category !== '_archived').map(p => p.category).filter(Boolean))];
                const all = [["", "全部"], ...cats.map(c => [c, c])];
                return all.map(([key, label]) => {
                  const active = productCategoryFilter === key;
                  return (
                    <div key={key || 'all'} onClick={() => setProductCategoryFilter(key)}
                      style={{ padding: "6px 14px", background: active ? "#1a73e8" : "#f0f2f5", color: active ? "#fff" : "#555", borderRadius: 16, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                      {label}
                    </div>
                  );
                });
              })()}
            </div>
            <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #f0f0f0", overflow: "hidden" }}>
              <div style={{ display: "grid", gridTemplateColumns: "36px 60px 2.5fr 0.8fr 1fr 1fr 0.8fr", gap: 12, padding: "12px 16px", background: "#fafbfc", borderBottom: "1px solid #f0f0f0", fontSize: 12, color: "#666", fontWeight: 600 }}>
                <div><input type="checkbox" /></div>
                <div>圖片</div>
                <div>商品</div>
                <div>狀態</div>
                <div>庫存</div>
                <div>類別</div>
                <div style={{ textAlign: "right" }}>價格</div>
              </div>
              {products.filter(p => {
                // 只显示顶层产品（非子 SKU）+ 隐藏 _archived 老数据
                if (p.parent_product_id) return false;
                if (p.category === '_archived') return false;
                if (productCategoryFilter && p.category !== productCategoryFilter) return false;
                const q = search.toLowerCase();
                return !q || (p.name || "").toLowerCase().includes(q) || (p.internal_code || "").toLowerCase().includes(q) || (p.category || "").toLowerCase().includes(q) || (p.specs || "").toLowerCase().includes(q);
              }).map(p => {
                const children = products.filter(c => c.parent_product_id === p.id);
                const hasChildren = children.length > 0;
                const status = p.status || "active";
                // 分仓聚合：某产品（+所有子 SKU）在每个仓库的总数
                const stockByWarehouse = warehouses.map(w => {
                  const pids = hasChildren ? children.map(c => c.id) : [p.id];
                  const qty = stocks.filter(s => s.warehouse_id === w.id && pids.includes(s.product_id)).reduce((sum, s) => sum + (s.qty || 0), 0);
                  return { warehouse: w, qty };
                });
                const totalStock = stockByWarehouse.reduce((s, x) => s + x.qty, 0);
                const prices = hasChildren ? children.map(c => c.price ?? 0).filter(v => v > 0) : [];
                const priceDisplay = hasChildren
                  ? (prices.length ? `HK$ ${Math.min(...prices)} - ${Math.max(...prices)}` : "—")
                  : `HK$ ${p.price}`;
                return (
                  <div key={p.id} onClick={() => setSelectedProduct(p)} style={{ display: "grid", gridTemplateColumns: "36px 60px 2.5fr 0.8fr 1.2fr 1fr 1.1fr", gap: 12, padding: "12px 16px", borderBottom: "1px solid #f5f5f5", alignItems: "center", fontSize: 13, cursor: "pointer" }}
                    onMouseEnter={e => e.currentTarget.style.background = "#fafbfc"}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                    <div onClick={e => e.stopPropagation()}><input type="checkbox" /></div>
                    {p.image_url ? (
                      <img src={p.image_url} style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 8, border: "1px solid #f0f0f0" }} />
                    ) : (
                      <div style={{ width: 48, height: 48, background: "#f0f2f5", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", color: "#bbb", fontSize: 10 }}>圖</div>
                    )}
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: "#1a1a1a" }}>{p.name}</div>
                      <div style={{ fontFamily: "monospace", fontSize: 10, color: "#aaa", marginTop: 2 }}>{p.internal_code || p.code || p.id.slice(0, 8)}</div>
                    </div>
                    <div>
                      <span style={{ padding: "3px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600, background: status === "draft" ? "#e5e7eb" : status === "discontinued" ? "#fee2e2" : "#d1fae5", color: status === "draft" ? "#6b7280" : status === "discontinued" ? "#991b1b" : "#047857" }}>
                        {status === "draft" ? "草稿" : status === "discontinued" ? "停售" : "啟用"}
                      </span>
                    </div>
                    <div onClick={hasChildren ? undefined : (e) => { e.stopPropagation(); setEditingProduct(p); }} style={{ cursor: hasChildren ? "default" : "pointer" }}>
                      {hasChildren && <div style={{ fontSize: 11, color: "#888", marginBottom: 2 }}>共 {children.length} 個子類 · 共 {totalStock} 件</div>}
                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                        {stockByWarehouse.map(({ warehouse, qty }) => (
                          <span key={warehouse.id} style={{ fontSize: 12 }}>
                            <span style={{ color: "#888" }}>{warehouse.name.replace("分部", "")}</span>
                            <span style={{ color: qty > 0 ? "#22c55e" : "#ef4444", fontWeight: 700, marginLeft: 4 }}>{qty}</span>
                          </span>
                        ))}
                        {!hasChildren && <span style={{ fontSize: 11, color: "#bbb" }}>✏️</span>}
                      </div>
                    </div>
                    <div style={{ color: "#555" }}>{p.category || "未分類"}</div>
                    <div style={{ textAlign: "right", fontWeight: 700, color: "#1a1a1a" }}>{priceDisplay}</div>
                  </div>
                );
              })}
              {products.length === 0 && (
                <div style={{ padding: 40, textAlign: "center", color: "#aaa" }}>暫無產品</div>
              )}
            </div>
          </div>
        )}

        {/* PRODUCT DETAIL */}
        {tab === "products" && selectedProduct && (() => {
          const p = selectedProduct;
          const children = products.filter(c => c.parent_product_id === p.id);
          const hasChildren = children.length > 0;
          const pids = hasChildren ? children.map(c => c.id) : [p.id];
          const allPids = [p.id, ...children.map(c => c.id)];
          // 90 天销售额
          const since = new Date(); since.setDate(since.getDate() - 90);
          let soldQty = 0, soldTotal = 0;
          const buyers = new Set();
          for (const inv of invoices) {
            if (!Array.isArray(inv.items) || !inv.date) continue;
            if (new Date(inv.date) < since) continue;
            const paid = (inv.status || "").toLowerCase() === "paid";
            if (!paid) continue;
            for (const it of inv.items) {
              if (!it || !it.name) continue;
              const matched = allPids.some(id => {
                const prod = products.find(pp => pp.id === id);
                return prod && prod.name === it.name;
              });
              if (matched) {
                soldQty += (it.qty || 1);
                soldTotal += (it.price || 0) * (it.qty || 1);
                if (inv.customer_id) buyers.add(inv.customer_id);
              }
            }
          }
          // 組織分類编辑
          const draft = productOrgDraft || { product_type: p.product_type || "", collections: p.collections || [], tags: p.tags || [] };
          const saveDraft = async () => {
            const { error } = await supabase.from("products").update({ product_type: draft.product_type || null, collections: draft.collections, tags: draft.tags }).eq("id", p.id);
            if (error) { alert("儲存失敗：" + error.message); return; }
            setProducts(prev => prev.map(x => x.id === p.id ? { ...x, ...draft } : x));
            setSelectedProduct(prev => ({ ...prev, ...draft }));
            setProductOrgDraft(null);
          };
          const collectionOpts = [...new Set(products.flatMap(x => x.collections || []))].filter(Boolean);
          const tagOpts = [...new Set(products.flatMap(x => x.tags || []))].filter(Boolean);
          return (
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
                <button onClick={() => { setSelectedProduct(null); setProductOrgDraft(null); }} style={{ background: "#f5f5f5", border: "none", borderRadius: 10, padding: "10px 14px", cursor: "pointer", fontSize: 14 }}>← 返回</button>
                <div>
                  <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>{p.name}</h1>
                  <div style={{ fontFamily: "monospace", fontSize: 12, color: "#aaa", marginTop: 4 }}>{p.internal_code}</div>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 20 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  {/* 產品圖片 */}
                  <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #f0f0f0", padding: 20 }}>
                    <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 14 }}>產品圖片</div>
                    {p.image_url ? (
                      <img src={p.image_url} style={{ width: "100%", maxHeight: 320, objectFit: "contain", borderRadius: 10, background: "#fafbfc", border: "1px solid #f0f0f0" }} />
                    ) : (
                      <div style={{ width: "100%", height: 200, background: "#f7f9fc", borderRadius: 10, border: "1px dashed #e0e0e0", display: "flex", alignItems: "center", justifyContent: "center", color: "#bbb", fontSize: 14 }}>尚無圖片</div>
                    )}
                    <label style={{ display: "inline-block", marginTop: 12, padding: "8px 16px", background: "#6382ff", color: "#fff", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 700 }}>
                      {p.image_url ? "替換圖片" : "上傳圖片"}
                      <input type="file" accept="image/*" style={{ display: "none" }} onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
                        const path = `${p.internal_code || p.id}/${Date.now()}.${ext}`;
                        const { error: upErr } = await supabase.storage.from('product-images').upload(path, file, { upsert: false });
                        if (upErr) { alert('上傳失敗：' + upErr.message); return; }
                        const { data: pub } = supabase.storage.from('product-images').getPublicUrl(path);
                        const url = pub.publicUrl;
                        const { error: dbErr } = await supabase.from('products').update({ image_url: url }).eq('id', p.id);
                        if (dbErr) { alert('保存失敗：' + dbErr.message); return; }
                        setProducts(prev => prev.map(x => x.id === p.id ? { ...x, image_url: url } : x));
                        setSelectedProduct(prev => ({ ...prev, image_url: url }));
                      }} />
                    </label>
                    {p.image_url && (
                      <button onClick={async () => {
                        if (!confirm('確定移除這張圖片？')) return;
                        const { error } = await supabase.from('products').update({ image_url: null }).eq('id', p.id);
                        if (error) { alert('移除失敗：' + error.message); return; }
                        setProducts(prev => prev.map(x => x.id === p.id ? { ...x, image_url: null } : x));
                        setSelectedProduct(prev => ({ ...prev, image_url: null }));
                      }} style={{ marginLeft: 8, padding: "8px 16px", background: "#f5f5f5", color: "#666", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13 }}>移除</button>
                    )}
                  </div>
                  {/* 子類（SKU 變體） */}
                  {hasChildren && (() => {
                    // 充電樁：按 kW + 相 分组渲染矩阵
                    const isPile = p.category === '充電樁';
                    if (isPile) {
                      const groups = {};
                      const lengthOrder = ['5M', '7M', '10M'];
                      const connOrder = ['RFID', 'Wifi'];
                      for (const c of children) {
                        const kw = c.name.match(/(\d+)kW/)?.[1];
                        const phase = c.name.match(/(單相|三相)/)?.[1];
                        const len = c.name.match(/(\d+M)(?=\s|$)/)?.[1];
                        const conn = /Wifi/i.test(c.name) ? 'Wifi' : (/RFID/i.test(c.name) ? 'RFID' : null);
                        if (!kw || !phase || !len || !conn) continue;
                        const key = `${kw}kW ${phase}`;
                        if (!groups[key]) groups[key] = { kw, phase, rows: {} };
                        if (!groups[key].rows[len]) groups[key].rows[len] = {};
                        groups[key].rows[len][conn] = c;
                      }
                      const groupKeys = Object.keys(groups).sort((a, b) => parseInt(a) - parseInt(b));
                      return (
                        <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #f0f0f0", padding: 20 }}>
                          <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 14 }}>子類 · 共 {children.length} 個（按規格分組）</div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            {groupKeys.map(key => {
                              const g = groups[key];
                              const expanded = expandedSkuGroups.has(key);
                              const allInGroup = Object.values(g.rows).flatMap(row => Object.values(row));
                              const groupStock = allInGroup.reduce((sum, c) => sum + stocks.filter(s => s.product_id === c.id).reduce((s2, s) => s2 + (s.qty || 0), 0), 0);
                              return (
                                <div key={key} style={{ border: "1px solid #f0f0f0", borderRadius: 8, overflow: "hidden" }}>
                                  <div onClick={() => setExpandedSkuGroups(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; })}
                                    style={{ padding: "12px 14px", background: expanded ? "#f7f9fc" : "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                      <span style={{ fontSize: 14, color: "#888" }}>{expanded ? "▼" : "▶"}</span>
                                      <div>
                                        <div style={{ fontSize: 14, fontWeight: 700 }}>Type2 充電樁 {key}</div>
                                        <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>{allInGroup.length} 個 SKU · 共 {groupStock} 件</div>
                                      </div>
                                    </div>
                                    <div style={{ fontSize: 12, color: "#666" }}>
                                      HK$ {Math.min(...allInGroup.map(c => c.price))} - {Math.max(...allInGroup.map(c => c.price))}
                                    </div>
                                  </div>
                                  {expanded && (
                                    <div style={{ padding: 12, background: "#fafbfc" }}>
                                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                                        <thead>
                                          <tr>
                                            <th style={{ textAlign: "left", padding: "6px 10px", color: "#888", fontWeight: 600, borderBottom: "1px solid #e8eaed" }}>線長</th>
                                            {connOrder.map(cn => (
                                              <th key={cn} style={{ textAlign: "left", padding: "6px 10px", color: "#888", fontWeight: 600, borderBottom: "1px solid #e8eaed" }}>{cn}</th>
                                            ))}
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {lengthOrder.map(len => (
                                            <tr key={len}>
                                              <td style={{ padding: "10px", fontWeight: 700, color: "#555" }}>{len}</td>
                                              {connOrder.map(cn => {
                                                const c = g.rows[len]?.[cn];
                                                if (!c) return <td key={cn} style={{ padding: 10, color: "#ccc" }}>—</td>;
                                                const qtys = warehouses.map(w => ({ w, qty: stocks.filter(s => s.product_id === c.id && s.warehouse_id === w.id).reduce((sum, s) => sum + (s.qty || 0), 0) }));
                                                return (
                                                  <td key={cn} onClick={() => setEditingProduct(c)} style={{ padding: "10px", cursor: "pointer", borderRadius: 6 }}
                                                    onMouseEnter={e => e.currentTarget.style.background = "#eef2ff"}
                                                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                                                    <div style={{ fontWeight: 700, color: "#1a1a1a" }}>HK$ {c.price}</div>
                                                    <div style={{ fontSize: 11, color: "#666", marginTop: 3 }}>
                                                      {qtys.map(({ w, qty }) => (
                                                        <span key={w.id} style={{ marginRight: 8 }}>
                                                          <span style={{ color: "#888" }}>{w.name.replace("分部", "")}</span>
                                                          <span style={{ color: qty > 0 ? "#22c55e" : "#ef4444", fontWeight: 700, marginLeft: 3 }}>{qty}</span>
                                                        </span>
                                                      ))}
                                                    </div>
                                                    <div style={{ fontFamily: "monospace", fontSize: 9, color: "#bbb", marginTop: 3 }}>{c.internal_code}</div>
                                                  </td>
                                                );
                                              })}
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    }
                    // 其他父产品（充電綫 4 SKU）：平铺
                    return (
                      <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #f0f0f0", padding: 20 }}>
                        <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 14 }}>子類 · 共 {children.length} 個</div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                          {children.map(c => {
                            const cStockByW = warehouses.map(w => ({ w, qty: stocks.filter(s => s.product_id === c.id && s.warehouse_id === w.id).reduce((sum, s) => sum + (s.qty || 0), 0) }));
                            return (
                              <div key={c.id} style={{ display: "grid", gridTemplateColumns: "48px 2fr 1.2fr 1fr 40px", gap: 12, alignItems: "center", padding: "10px 12px", borderRadius: 8, border: "1px solid #f0f0f0" }}>
                                {c.image_url ? (
                                  <img src={c.image_url} style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 6, border: "1px solid #f0f0f0" }} />
                                ) : (
                                  <div style={{ width: 40, height: 40, background: "#f0f2f5", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", color: "#bbb", fontSize: 9 }}>圖</div>
                                )}
                                <div>
                                  <div style={{ fontSize: 13, fontWeight: 600 }}>{c.name}</div>
                                  <div style={{ fontFamily: "monospace", fontSize: 10, color: "#aaa" }}>{c.internal_code}</div>
                                </div>
                                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 12 }}>
                                  {cStockByW.map(({ w, qty }) => (
                                    <span key={w.id}>
                                      <span style={{ color: "#888" }}>{w.name.replace("分部", "")}</span>
                                      <span style={{ color: qty > 0 ? "#22c55e" : "#ef4444", fontWeight: 700, marginLeft: 4 }}>{qty}</span>
                                    </span>
                                  ))}
                                </div>
                                <div style={{ textAlign: "right", fontSize: 13, fontWeight: 700 }}>HK$ {c.price}</div>
                                <button onClick={() => setEditingProduct(c)} style={{ background: "#f5f5f5", border: "none", borderRadius: 6, padding: "6px 10px", cursor: "pointer", fontSize: 12 }}>✏️</button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}
                  {/* 主产品无子类时直接显示它自己的库存 */}
                  {!hasChildren && (
                    <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #f0f0f0", padding: 20 }}>
                      <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 14 }}>分倉庫存</div>
                      {warehouses.map(w => {
                        const qty = stocks.filter(s => s.product_id === p.id && s.warehouse_id === w.id).reduce((sum, s) => sum + (s.qty || 0), 0);
                        return (
                          <div key={w.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #f5f5f5" }}>
                            <span>{w.name}</span>
                            <span style={{ color: qty > 0 ? "#22c55e" : "#ef4444", fontWeight: 700 }}>{qty} 件</span>
                          </div>
                        );
                      })}
                      <button onClick={() => setEditingProduct(p)} style={{ marginTop: 12, background: "#6382ff", color: "#fff", border: "none", borderRadius: 8, padding: "8px 14px", cursor: "pointer", fontSize: 13, fontWeight: 700 }}>修改庫存</button>
                    </div>
                  )}
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  {/* 90 天销售额 */}
                  <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #f0f0f0", padding: 20 }}>
                    <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 12 }}>過去 90 天的銷售額</div>
                    <div style={{ fontSize: 13, color: "#555", lineHeight: 1.8 }}>
                      <div>• 售出 <b>{soldQty}</b> 件</div>
                      <div>• <b>{buyers.size}</b> 位買家</div>
                      <div>• 銷貨淨額 <b>HK$ {soldTotal.toLocaleString()}</b></div>
                    </div>
                  </div>
                  {/* 商品組織分類 */}
                  <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #f0f0f0", padding: 20 }}>
                    <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 14 }}>商品組織分類</div>
                    <div style={{ marginBottom: 12 }}>
                      <label style={{ fontSize: 12, color: "#888", display: "block", marginBottom: 4 }}>類型</label>
                      <input value={draft.product_type} onChange={e => setProductOrgDraft({ ...draft, product_type: e.target.value })} placeholder="如 EV / 配件"
                        style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #e0e0e0", fontSize: 13, boxSizing: "border-box" }} />
                    </div>
                    <div style={{ marginBottom: 12 }}>
                      <label style={{ fontSize: 12, color: "#888", display: "block", marginBottom: 4 }}>商品系列</label>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
                        {draft.collections.map((c, i) => (
                          <span key={i} style={{ background: "#f0f4ff", color: "#6382ff", padding: "4px 8px", borderRadius: 6, fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
                            {c}
                            <button onClick={() => setProductOrgDraft({ ...draft, collections: draft.collections.filter((_, j) => j !== i) })} style={{ background: "none", border: "none", cursor: "pointer", color: "#6382ff", padding: 0 }}>×</button>
                          </span>
                        ))}
                      </div>
                      <input placeholder="輸入後回車新增" list="collection-opts" onKeyDown={e => {
                        if (e.key === "Enter" && e.target.value.trim()) {
                          const v = e.target.value.trim();
                          if (!draft.collections.includes(v)) setProductOrgDraft({ ...draft, collections: [...draft.collections, v] });
                          e.target.value = "";
                        }
                      }} style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #e0e0e0", fontSize: 13, boxSizing: "border-box" }} />
                      <datalist id="collection-opts">{collectionOpts.map(o => <option key={o} value={o} />)}</datalist>
                    </div>
                    <div style={{ marginBottom: 12 }}>
                      <label style={{ fontSize: 12, color: "#888", display: "block", marginBottom: 4 }}>標籤</label>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
                        {draft.tags.map((t, i) => (
                          <span key={i} style={{ background: "#fff6e5", color: "#b87500", padding: "4px 8px", borderRadius: 6, fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
                            {t}
                            <button onClick={() => setProductOrgDraft({ ...draft, tags: draft.tags.filter((_, j) => j !== i) })} style={{ background: "none", border: "none", cursor: "pointer", color: "#b87500", padding: 0 }}>×</button>
                          </span>
                        ))}
                      </div>
                      <input placeholder="輸入後回車新增" list="tag-opts" onKeyDown={e => {
                        if (e.key === "Enter" && e.target.value.trim()) {
                          const v = e.target.value.trim();
                          if (!draft.tags.includes(v)) setProductOrgDraft({ ...draft, tags: [...draft.tags, v] });
                          e.target.value = "";
                        }
                      }} style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #e0e0e0", fontSize: 13, boxSizing: "border-box" }} />
                      <datalist id="tag-opts">{tagOpts.map(o => <option key={o} value={o} />)}</datalist>
                    </div>
                    {productOrgDraft && (
                      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                        <button onClick={() => setProductOrgDraft(null)} style={{ flex: 1, padding: "8px 10px", background: "#f5f5f5", border: "none", borderRadius: 8, fontSize: 13, cursor: "pointer" }}>取消</button>
                        <button onClick={saveDraft} style={{ flex: 1, padding: "8px 10px", background: "#6382ff", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>儲存</button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

        {/* CUSTOMERS */}
        {tab === "customers" && !selectedCustomer && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
              <div>
                <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>客戶</h1>
                <p style={{ color: "#888", margin: "4px 0 0", fontSize: 14 }}>
                  {customerTimeRange === "all"
                    ? `共 ${filteredCustomers.length} 位客戶`
                    : `共 ${filteredCustomers.length} 位客戶（${customerTimeRange}天內有購買）`}
                </p>
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                {(() => {
                  const candidates = customerGroups.virtualCustomers.filter(v => (v.groupCids || []).length > 1);
                  if (candidates.length === 0) return null;
                  return (
                    <button
                      onClick={() => setMergeCandidatesOpen(true)}
                      title="列出所有虛擬合併的客戶組，一鍵升級為物理合併"
                      style={{ display: "flex", alignItems: "center", gap: 8, background: "#fff6e5", color: "#b87500", border: "1px solid #ffd88a", borderRadius: 10, padding: "10px 16px", cursor: "pointer", fontWeight: 700, fontSize: 14 }}
                    >🔍 疑似重複 {candidates.length} 組</button>
                  );
                })()}
                <button onClick={() => setShowAddCustomer(true)} style={{ display: "flex", alignItems: "center", gap: 8, background: "#6382ff", color: "#fff", border: "none", borderRadius: 10, padding: "10px 18px", cursor: "pointer", fontWeight: 700, fontSize: 14 }}>
                  <Icon name="plus" size={16} /> 新增客戶
                </button>
              </div>
            </div>

            <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #f0f0f0", padding: "10px 14px", marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
              <Icon name="search" size={15} />
              <input placeholder="搜尋客戶..." value={search} onChange={e => { setSearch(e.target.value); setVisibleCustomers(30); }} style={{ border: "none", background: "none", outline: "none", fontSize: 14, width: "100%" }} />
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontSize: 13, color: "#888", marginRight: 4 }}>排序：</span>
              {[["created", "建立時間"], ["lastPurchase", "最近購買"]].map(([k, label]) => (
                <button key={k} onClick={() => { setCustomerSort(k); setVisibleCustomers(30); }} style={{ padding: "6px 14px", borderRadius: 20, border: customerSort === k ? "1px solid #6382ff" : "1px solid #e0e0e0", background: customerSort === k ? "#f0f4ff" : "#fff", color: customerSort === k ? "#6382ff" : "#666", fontSize: 13, fontWeight: customerSort === k ? 700 : 400, cursor: "pointer" }}>{label}</button>
              ))}
              <button onClick={() => { setCustomerSortDir(d => d === "desc" ? "asc" : "desc"); setVisibleCustomers(30); }} title={customerSortDir === "desc" ? "目前降序（新→舊），點擊切換為升序" : "目前升序（舊→新），點擊切換為降序"} style={{ padding: "6px 14px", borderRadius: 20, border: "1px solid #6382ff", background: "#6382ff", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                {customerSortDir === "desc" ? "↓ 降序" : "↑ 升序"}
              </button>
              <span style={{ fontSize: 13, color: "#888", marginLeft: 12, marginRight: 4 }}>時間：</span>
              {[["all", "全部"], ["7", "7天"], ["30", "30天"], ["90", "90天"]].map(([k, label]) => (
                <button key={k} onClick={() => { setCustomerTimeRange(k); setVisibleCustomers(30); }} style={{ padding: "6px 14px", borderRadius: 20, border: customerTimeRange === k ? "1px solid #6382ff" : "1px solid #e0e0e0", background: customerTimeRange === k ? "#f0f4ff" : "#fff", color: customerTimeRange === k ? "#6382ff" : "#666", fontSize: 13, fontWeight: customerTimeRange === k ? 700 : 400, cursor: "pointer" }}>{label}</button>
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
                          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 3 }}>
                            <span style={{ fontSize: 16, fontWeight: 800 }}>{c.name}</span>
                            <Badge status={c.type || "Regular"} />
                          </div>
                          <div style={{ fontSize: 13, color: "#666" }}>{c.email} · {c.phone}</div>
                          {c.car_make && <div style={{ fontSize: 12, color: "#aaa", marginTop: 2 }}>🚗 {c.car_make} {c.car_model}</div>}
                        </div>
                        <div style={{ display: "flex", gap: 12, textAlign: "center" }}>
                          <div style={{ padding: "8px 14px", background: "#f0f4ff", borderRadius: 10 }}>
                            <div style={{ fontSize: 16, fontWeight: 800, color: "#6382ff" }}>HKD${total.toLocaleString()}</div>
                            <div style={{ fontSize: 11, color: "#888" }}>累計</div>
                          </div>
                          <div style={{ padding: "8px 14px", background: "#fff8f0", borderRadius: 10 }}>
                            <div style={{ fontSize: 16, fontWeight: 800, color: "#f59e0b" }}>{custInvoices.length}</div>
                            <div style={{ fontSize: 11, color: "#888" }}>訂單</div>
                          </div>
                        </div>
                      </div>
                );
              })}
              {visibleCustomers < filteredCustomers.length && (
                <button onClick={() => setVisibleCustomers(v => v + 30)} style={{ display: "block", margin: "12px auto", padding: "10px 28px", background: "#f0f4ff", color: "#6382ff", border: "1px solid #e0e8ff", borderRadius: 10, cursor: "pointer", fontWeight: 700, fontSize: 14 }}>
                  載入更多（{filteredCustomers.length - visibleCustomers} 項待載入）
                </button>
              )}
            </div>
          </div>
        )}

        {/* CUSTOMER PROFILE */}
        {tab === "customers" && selectedCustomer && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <button onClick={() => setSelectedCustomer(null)} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", color: "#6382ff", fontWeight: 700, fontSize: 14, padding: 0 }}>
                <Icon name="back" size={16} /> 返回客戶列表
              </button>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => openEditCustomer(selectedCustomer)} title="編輯客戶" style={{ display: "flex", alignItems: "center", gap: 6, background: "#fff9ec", color: "#d08700", border: "1px solid #f4dca4", borderRadius: 8, padding: "7px 14px", cursor: "pointer", fontWeight: 700, fontSize: 13 }}>
                  ✏️ 編輯客戶
                </button>
                <button onClick={() => handleDeleteCustomer(selectedCustomer)} title="刪除客戶" style={{ display: "flex", alignItems: "center", gap: 6, background: "#fff0f0", color: "#d14343", border: "1px solid #ffcccc", borderRadius: 8, padding: "7px 14px", cursor: "pointer", fontWeight: 700, fontSize: 13 }}>
                  🗑️ 刪除客戶
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
                          title="查看合併記錄"
                        >
                          已合併 {totalCount} 條重複記錄 →
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
                          {blk(phones, v => <>📱 香港：{v}</>)}
                          {blk(phoneMainlands, v => <>📱 內地：{v}</>)}
                          {blk(cars, v => <>🚗 {v}</>)}
                          {selectedCustomer.referral && <div>🔗 來源：{selectedCustomer.referral}</div>}
                        </div>
                        {addresses.length > 0 && (
                          <div style={{ marginTop: 10, fontSize: 14, display: "flex", flexDirection: "column", gap: 4 }}>
                            {addresses.map((a, i) => <div key={i}>📍 {addresses.length > 1 ? `地址 ${i + 1}：` : ""}{a}</div>)}
                          </div>
                        )}
                      </>
                    );
                  })()}
                  {selectedCustomer.interest_products?.length > 0 && (
                    <div style={{ marginTop: 10 }}>
                      <span style={{ fontSize: 13, color: "#888" }}>感興趣產品：</span>
                      {selectedCustomer.interest_products.map(p => (
                        <span key={p} style={{ background: "#f0f4ff", color: "#6382ff", borderRadius: 20, padding: "3px 10px", fontSize: 12, fontWeight: 600, marginRight: 6 }}>{p}</span>
                      ))}
                    </div>
                  )}
                  {selectedCustomer.notes && <div style={{ marginTop: 10, fontSize: 13, color: "#888", background: "#f9f9f9", borderRadius: 8, padding: "8px 12px" }}>📝 {selectedCustomer.notes}</div>}
                </div>
              </div>
            </div>

            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>購買記錄</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {(() => {
                const scCids = selectedCustomer.allCids || selectedCustomer.groupCids || [selectedCustomer.id];
                const myInvoices = invoices.filter(i => scCids.includes(i.customer_id)).slice().sort((a, b) => {
                  const da = a.date || "", db = b.date || "";
                  if (da !== db) return db.localeCompare(da);
                  return String(b.created_at || "").localeCompare(String(a.created_at || ""));
                });
                if (myInvoices.length === 0) return (<div style={{ background: "#fff", borderRadius: 14, padding: 24, textAlign: "center", color: "#aaa", border: "1px solid #f0f0f0" }}>暫無購買記錄</div>);
                return myInvoices.map(inv => (
                <div key={inv.id} style={{ background: "#fff", borderRadius: 14, padding: "18px 22px", border: "1px solid #f0f0f0", boxShadow: "0 2px 8px rgba(0,0,0,0.03)", display: "flex", alignItems: "center", gap: 16 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 800, fontSize: 15 }}>{fmtInvNum(inv)}</div>
                    <div style={{ fontSize: 13, color: "#888", marginTop: 3 }}>{inv.date || "日期未知"} · {formatNotes(inv.notes)}</div>
                    {Array.isArray(inv.items) && inv.items.map((item, i) => (
                      <div key={i} style={{ fontSize: 12, color: "#666", marginTop: 2 }}>{item.name} ×{item.qty} — HKD${item.price}</div>
                    ))}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                    {(inv.status || "").trim().toLowerCase() !== "paid" && (
                      <button onClick={() => handleMarkPaid(inv)} title="標記已付款" style={{ fontSize: 12, background: "#e8f5e9", color: "#22c55e", border: "1px solid #c8e6c9", borderRadius: 8, padding: "7px 10px", cursor: "pointer", fontWeight: 700, display: "flex", alignItems: "center", gap: 5 }}>
                        ✓ 標記已付款
                      </button>
                    )}
                    <div style={{ fontSize: 18, fontWeight: 800 }}>HKD${inv.total}</div>
                    <Badge status={inv.status} />
                    <button onClick={() => openEditInvoice(inv)} title="編輯發票" style={{ fontSize: 12, background: "#fff8e1", color: "#f59e0b", border: "none", borderRadius: 8, padding: "7px 10px", cursor: "pointer", fontWeight: 700 }}>
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
          </div>
        )}

        {/* INVOICES */}
        {tab === "invoices" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
              <div>
                <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>發票</h1>
                <p style={{ color: "#888", margin: "4px 0 0", fontSize: 14 }}>共 {invoices.length} 張發票</p>
              </div>
              <button onClick={() => setShowNewInvoice(true)} style={{ display: "flex", alignItems: "center", gap: 8, background: "#6382ff", color: "#fff", border: "none", borderRadius: 10, padding: "10px 18px", cursor: "pointer", fontWeight: 700, fontSize: 14 }}>
                <Icon name="plus" size={16} /> 新建發票
              </button>
            </div>

            <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #f0f0f0", padding: "10px 14px", marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
              <Icon name="search" size={15} />
              <input placeholder="搜尋發票..." value={search} onChange={e => { setSearch(e.target.value); setVisibleInvoices(30); }} style={{ border: "none", background: "none", outline: "none", fontSize: 14, width: "100%" }} />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {filteredInvoices.slice(0, visibleInvoices).map(inv => {
                const c = getCustomer(inv.customer_id);
                return (
                  <div key={inv.id} style={{ background: "#fff", borderRadius: 14, padding: "18px 22px", border: "1px solid #f0f0f0", boxShadow: "0 2px 8px rgba(0,0,0,0.03)", display: "flex", alignItems: "center", gap: 18 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 800, fontSize: 15 }}>{fmtInvNum(inv)}</div>
                      <div style={{ fontSize: 13, color: "#888", marginTop: 2 }}>{(c?.phone || c?.phone_mainland) ? `${c.phone || c.phone_mainland} · ` : ""}{c?.name || "—"} · {inv.date || "日期未知"} · {formatNotes(inv.notes)}</div>
                      {Array.isArray(inv.items) && inv.items.slice(0, 2).map((item, i) => (
                        <div key={i} style={{ fontSize: 12, color: "#999" }}>{item.name} ×{item.qty}</div>
                      ))}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                      {(inv.status || "").trim().toLowerCase() !== "paid" && (
                        <button onClick={() => handleMarkPaid(inv)} title="標記已付款" style={{ fontSize: 12, background: "#e8f5e9", color: "#22c55e", border: "1px solid #c8e6c9", borderRadius: 8, padding: "7px 10px", cursor: "pointer", fontWeight: 700, display: "flex", alignItems: "center", gap: 5 }}>
                          ✓ 標記已付款
                        </button>
                      )}
                      <div style={{ fontSize: 18, fontWeight: 800 }}>HKD${inv.total}</div>
                      <Badge status={inv.status} />
                      <button onClick={() => openEditInvoice(inv)} title="編輯發票" style={{ fontSize: 12, background: "#fff8e1", color: "#f59e0b", border: "none", borderRadius: 8, padding: "7px 10px", cursor: "pointer", fontWeight: 700 }}>
                        ✏️
                      </button>
                      <button onClick={() => openPrintChooser(inv, c, inv.items || [], products)} style={{ fontSize: 12, background: "#f0f4ff", color: "#6382ff", border: "none", borderRadius: 8, padding: "7px 12px", cursor: "pointer", fontWeight: 700, display: "flex", alignItems: "center", gap: 5 }}>
                        <Icon name="print" size={13} /> 列印
                      </button>
                      <button onClick={() => handleDeleteInvoice(inv)} title="刪除發票" style={{ fontSize: 12, background: "#fff0f0", color: "#d14343", border: "none", borderRadius: 8, padding: "7px 10px", cursor: "pointer", fontWeight: 700, display: "flex", alignItems: "center", gap: 5 }}>
                        🗑️
                      </button>
                    </div>
                  </div>
                );
              })}
              {visibleInvoices < filteredInvoices.length && (
                <button onClick={() => setVisibleInvoices(v => v + 30)} style={{ display: "block", margin: "12px auto", padding: "10px 28px", background: "#f0f4ff", color: "#6382ff", border: "1px solid #e0e8ff", borderRadius: 10, cursor: "pointer", fontWeight: 700, fontSize: 14 }}>
                  載入更多（{filteredInvoices.length - visibleInvoices} 項待載入）
                </button>
              )}
            </div>
          </div>
        )}

        {/* WARRANTY */}
        {tab === "warranty" && (() => {
          const counts = {
            all: allWarrantyItems.length,
            expired: allWarrantyItems.filter(w => w.bucket === "expired").length,
            week: allWarrantyItems.filter(w => w.bucket === "week").length,
            soon: allWarrantyItems.filter(w => w.bucket === "soon").length,
            near: allWarrantyItems.filter(w => w.bucket === "near").length,
            far: allWarrantyItems.filter(w => w.bucket === "far").length,
          };
          const q = warrantySearch.toLowerCase().trim();
          const filtered = allWarrantyItems.filter(w => {
            if (warrantyBucket !== "all" && w.bucket !== warrantyBucket) return false;
            if (!q) return true;
            return (w.customerName || "").toLowerCase().includes(q)
              || (w.customerPhone || "").toLowerCase().includes(q)
              || (w.productName || "").toLowerCase().includes(q)
              || (w.invoiceNum || "").toLowerCase().includes(q);
          });
          const bucketColor = (b) => b === "expired" ? "#d14343" : b === "week" ? "#ea580c" : b === "soon" ? "#f59e0b" : b === "near" ? "#6382ff" : "#22c55e";
          const bucketLabel = (b) => b === "expired" ? "已過期" : b === "week" ? "一週內" : b === "soon" ? "30 天內" : b === "near" ? "90 天內" : "一年內";
          const filterBtns = [
            { k: "all", label: `全部 (${counts.all})`, color: "#555" },
            { k: "expired", label: `已過期 (${counts.expired})`, color: "#d14343" },
            { k: "week", label: `一週內 (${counts.week})`, color: "#ea580c" },
            { k: "soon", label: `30 天內 (${counts.soon})`, color: "#f59e0b" },
            { k: "near", label: `90 天內 (${counts.near})`, color: "#6382ff" },
            { k: "far", label: `一年內 (${counts.far})`, color: "#22c55e" },
          ];
          return (
            <div>
              <div style={{ marginBottom: 24 }}>
                <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>保修</h1>
                <p style={{ color: "#888", margin: "4px 0 0", fontSize: 14 }}>共 {counts.all} 件需跟進（過期 30 天內 + 未來 365 天內到期，僅顯示有聯繫方式的客戶）</p>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
                {filterBtns.map(b => (
                  <button key={b.k} onClick={() => { setWarrantyBucket(b.k); setVisibleWarranty(50); }} style={{ padding: "8px 16px", borderRadius: 20, border: warrantyBucket === b.k ? `2px solid ${b.color}` : "1px solid #e0e0e0", background: warrantyBucket === b.k ? b.color + "18" : "#fff", color: warrantyBucket === b.k ? b.color : "#555", fontSize: 13, fontWeight: warrantyBucket === b.k ? 700 : 500, cursor: "pointer" }}>{b.label}</button>
                ))}
              </div>
              <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #f0f0f0", padding: "10px 14px", marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
                <Icon name="search" size={15} />
                <input placeholder="搜尋客戶名 / 電話 / 產品 / 發票號..." value={warrantySearch} onChange={e => { setWarrantySearch(e.target.value); setVisibleWarranty(50); }} style={{ border: "none", background: "none", outline: "none", fontSize: 14, width: "100%" }} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {filtered.length === 0 ? (
                  <div style={{ padding: 40, textAlign: "center", color: "#999" }}>沒有符合條件的保修記錄</div>
                ) : filtered.slice(0, visibleWarranty).map((w, idx) => (
                  <div key={w.invoiceId + "-" + idx} onClick={() => { if (w.customer) { setTab("customers"); setSelectedCustomer(w.customer); } }} style={{ background: "#fff", borderRadius: 12, padding: "14px 18px", border: "1px solid #f0f0f0", boxShadow: "0 2px 6px rgba(0,0,0,0.02)", display: "flex", alignItems: "center", gap: 14, cursor: w.customer ? "pointer" : "default", transition: "border-color 0.15s" }}
                    onMouseEnter={e => { if (w.customer) e.currentTarget.style.borderColor = "#6382ff"; }}
                    onMouseLeave={e => e.currentTarget.style.borderColor = "#f0f0f0"}>
                    <div style={{ width: 6, alignSelf: "stretch", background: bucketColor(w.bucket), borderRadius: 3 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                        <span style={{ fontWeight: 800, fontSize: 15 }}>{w.customerName}</span>
                        {w.customerPhone && <span style={{ fontSize: 12, color: "#888" }}>· {w.customerPhone}</span>}
                        <span style={{ fontSize: 11, color: bucketColor(w.bucket), fontWeight: 700, padding: "2px 8px", background: bucketColor(w.bucket) + "18", borderRadius: 8 }}>{bucketLabel(w.bucket)}</span>
                      </div>
                      <div style={{ fontSize: 13, color: "#666", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{w.productName} · {w.invoiceNum} · 購買 {w.invoiceDate}</div>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 800, color: bucketColor(w.bucket) }}>{w.warrantyEnd}</div>
                      <div style={{ fontSize: 12, color: "#888" }}>{w.daysLeft < 0 ? `已過 ${-w.daysLeft} 天` : `剩餘 ${w.daysLeft} 天`}</div>
                    </div>
                  </div>
                ))}
                {visibleWarranty < filtered.length && (
                  <button onClick={() => setVisibleWarranty(v => v + 50)} style={{ display: "block", margin: "12px auto", padding: "10px 28px", background: "#f0f4ff", color: "#6382ff", border: "1px solid #e0e8ff", borderRadius: 10, cursor: "pointer", fontWeight: 700, fontSize: 14 }}>
                    載入更多（{filtered.length - visibleWarranty} 項待載入）
                  </button>
                )}
              </div>
            </div>
          );
        })()}

        {/* REVENUE */}
        {tab === "revenue" && (() => {
          const paidInvoices = invoices.filter(i => (i.status || "").trim().toLowerCase() === "paid");
          // 時間範圍過濾
          const today = new Date();
          const rangeStart = (() => {
            const d = new Date(today);
            if (revenueRange === "thisMonth") return new Date(today.getFullYear(), today.getMonth(), 1);
            if (revenueRange === "lastMonth") return new Date(today.getFullYear(), today.getMonth() - 1, 1);
            if (revenueRange === "3m") { d.setMonth(d.getMonth() - 3); return d; }
            if (revenueRange === "12m") { d.setMonth(d.getMonth() - 12); return d; }
            if (revenueRange === "year") return new Date(today.getFullYear(), 0, 1);
            return new Date(2000, 0, 1);
          })();
          const rangeEnd = (() => {
            if (revenueRange === "lastMonth") return new Date(today.getFullYear(), today.getMonth(), 1);
            return today;
          })();
          const inRange = paidInvoices.filter(i => {
            if (!i.date) return false;
            const d = new Date(i.date);
            return d >= rangeStart && d < rangeEnd;
          });
          const totalRevenue = inRange.reduce((s, i) => s + (i.total || 0), 0);
          const invCount = inRange.length;
          const avgValue = invCount > 0 ? Math.round(totalRevenue / invCount) : 0;
          // 所有發票（含未付款）在範圍內用於狀態統計
          const allInRange = invoices.filter(i => {
            if (!i.date) return false;
            const d = new Date(i.date);
            return d >= rangeStart && d < rangeEnd;
          });
          const unpaidCount = allInRange.filter(i => (i.status || "").trim().toLowerCase() !== "paid").length;
          const unpaidAmount = allInRange.filter(i => (i.status || "").trim().toLowerCase() !== "paid").reduce((s, i) => s + (i.total || 0), 0);
          // 按月聚合（最多 24 月）
          const monthMap = {};
          inRange.forEach(i => {
            const m = (i.date || "").slice(0, 7);
            if (!m) return;
            monthMap[m] = (monthMap[m] || 0) + (i.total || 0);
          });
          const monthKeys = Object.keys(monthMap).sort();
          const maxMonth = Math.max(1, ...Object.values(monthMap));
          // 產品 Top 10（按銷售金額）
          const prodMap = {};
          inRange.forEach(i => {
            if (!Array.isArray(i.items)) return;
            i.items.forEach(it => {
              const name = it.name || "未命名";
              const amt = (Number(it.price) || 0) * (Number(it.qty) || 0);
              prodMap[name] = (prodMap[name] || 0) + amt;
            });
          });
          const prodTop = Object.entries(prodMap).sort((a, b) => b[1] - a[1]).slice(0, 10);
          const maxProd = Math.max(1, ...prodTop.map(p => p[1]));
          // 客戶 Top 10：依 customerGroups（4 欄位命中 3+ 視為同一人）合併。無名堆一條
          const custMap = {};
          inRange.forEach(i => {
            if (!i.customer_id) return;
            const groupId = customerGroups.idToGroup.get(i.customer_id);
            const info = groupId ? customerGroups.groupInfo.get(groupId) : null;
            const names = info ? Array.from(info.names) : [];
            const phones = info ? Array.from(info.phones) : [];
            const emails = info ? Array.from(info.emails) : [];
            let key;
            if (names.length > 0) {
              key = "G:" + groupId;
            } else {
              key = "UNNAMED";
            }
            if (!custMap[key]) {
              custMap[key] = {
                name: names.length > 0 ? names.join(" / ") : "(無名客戶)",
                phone: phones.join(", "),
                email: emails.join(", "),
                amt: 0,
              };
            }
            custMap[key].amt += i.total || 0;
          });
          const custTop = Object.values(custMap).sort((a, b) => b.amt - a.amt).slice(0, 10);
          const maxCust = Math.max(1, ...custTop.map(c => c.amt));
          const ranges = [
            { k: "thisMonth", label: "本月" },
            { k: "lastMonth", label: "上月" },
            { k: "3m", label: "近 3 月" },
            { k: "12m", label: "近 12 月" },
            { k: "year", label: "本年度" },
            { k: "all", label: "全部" },
          ];
          return (
            <div>
              <div style={{ marginBottom: 20 }}>
                <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>營收</h1>
                <p style={{ color: "#888", margin: "4px 0 0", fontSize: 14 }}>僅統計已付款（Paid）發票</p>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
                {ranges.map(r => (
                  <button key={r.k} onClick={() => setRevenueRange(r.k)} style={{ padding: "8px 16px", borderRadius: 20, border: revenueRange === r.k ? "2px solid #6382ff" : "1px solid #e0e0e0", background: revenueRange === r.k ? "#eef2ff" : "#fff", color: revenueRange === r.k ? "#6382ff" : "#555", fontSize: 13, fontWeight: revenueRange === r.k ? 700 : 500, cursor: "pointer" }}>{r.label}</button>
                ))}
              </div>
              {/* KPI cards */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 20 }}>
                <div style={{ background: "#fff", borderRadius: 14, padding: "20px 24px", border: "1px solid #f0f0f0" }}>
                  <div style={{ fontSize: 12, color: "#888", fontWeight: 600, letterSpacing: "0.04em" }}>總營收</div>
                  <div style={{ fontSize: 26, fontWeight: 800, color: "#6382ff", marginTop: 4 }}>HKD${Math.round(totalRevenue).toLocaleString()}</div>
                </div>
                <div style={{ background: "#fff", borderRadius: 14, padding: "20px 24px", border: "1px solid #f0f0f0" }}>
                  <div style={{ fontSize: 12, color: "#888", fontWeight: 600, letterSpacing: "0.04em" }}>已付發票數</div>
                  <div style={{ fontSize: 26, fontWeight: 800, color: "#22c55e", marginTop: 4 }}>{invCount}</div>
                </div>
                <div style={{ background: "#fff", borderRadius: 14, padding: "20px 24px", border: "1px solid #f0f0f0" }}>
                  <div style={{ fontSize: 12, color: "#888", fontWeight: 600, letterSpacing: "0.04em" }}>平均單據</div>
                  <div style={{ fontSize: 26, fontWeight: 800, color: "#f59e0b", marginTop: 4 }}>HKD${avgValue.toLocaleString()}</div>
                </div>
                <div style={{ background: "#fff", borderRadius: 14, padding: "20px 24px", border: "1px solid #f0f0f0" }}>
                  <div style={{ fontSize: 12, color: "#888", fontWeight: 600, letterSpacing: "0.04em" }}>未付款</div>
                  <div style={{ fontSize: 26, fontWeight: 800, color: "#d14343", marginTop: 4 }}>{unpaidCount}</div>
                  <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>HKD${unpaidAmount.toLocaleString()}</div>
                </div>
              </div>
              {/* 月度柱状图（多月份）/ 產品佔比餅圖（單月） */}
              {monthKeys.length > 1 ? (
                <div style={{ background: "#fff", borderRadius: 14, padding: 24, border: "1px solid #f0f0f0", marginBottom: 20 }}>
                  <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 700 }}>月度營收趨勢</h3>
                  <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 220, overflowX: "auto", paddingBottom: 6 }}>
                    {monthKeys.map(m => {
                      const v = monthMap[m];
                      const h = Math.max(4, (v / maxMonth) * 180);
                      return (
                        <div key={m} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, minWidth: 50, flex: "1 0 50px" }}>
                          <div style={{ fontSize: 10, color: "#888", fontWeight: 600 }}>{v >= 10000 ? `${Math.round(v/1000)}k` : v}</div>
                          <div style={{ width: "100%", height: h, background: "linear-gradient(180deg,#6382ff,#a78bfa)", borderRadius: "6px 6px 0 0" }} title={`${m}: HKD$${v.toLocaleString()}`} />
                          <div style={{ fontSize: 10, color: "#888" }}>{m.slice(2)}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (() => {
                const sortedProds = Object.entries(prodMap).sort((a, b) => b[1] - a[1]);
                const top6 = sortedProds.slice(0, 6);
                const restSum = sortedProds.slice(6).reduce((s, [, v]) => s + v, 0);
                const pieData = [
                  ...top6.map(([n, v]) => ({ name: n, value: v })),
                  ...(restSum > 0 ? [{ name: "其他", value: restSum }] : []),
                ];
                const pieTotal = pieData.reduce((s, d) => s + d.value, 0);
                const colors = ["#6382ff", "#a78bfa", "#f59e0b", "#22c55e", "#ef4444", "#ea580c", "#14b8a6"];
                if (pieTotal === 0) return null;
                let offset = -Math.PI / 2;
                return (
                  <div style={{ background: "#fff", borderRadius: 14, padding: 24, border: "1px solid #f0f0f0", marginBottom: 20 }}>
                    <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 700 }}>產品銷售佔比</h3>
                    <div style={{ display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap" }}>
                      <svg viewBox="0 0 100 100" style={{ width: 240, height: 240, flexShrink: 0 }}>
                        {pieData.length === 1 ? (
                          <circle cx="50" cy="50" r="40" fill={colors[0]} />
                        ) : pieData.map((d, i) => {
                          const angle = (d.value / pieTotal) * 2 * Math.PI;
                          const x1 = 50 + 40 * Math.cos(offset);
                          const y1 = 50 + 40 * Math.sin(offset);
                          offset += angle;
                          const x2 = 50 + 40 * Math.cos(offset);
                          const y2 = 50 + 40 * Math.sin(offset);
                          const large = angle > Math.PI ? 1 : 0;
                          return <path key={i} d={`M 50 50 L ${x1} ${y1} A 40 40 0 ${large} 1 ${x2} ${y2} Z`} fill={colors[i % colors.length]} stroke="#fff" strokeWidth="0.5" />;
                        })}
                      </svg>
                      <div style={{ flexShrink: 0, maxWidth: 480 }}>
                        {pieData.map((d, i) => (
                          <div key={i} style={{ display: "grid", gridTemplateColumns: "14px 1fr auto auto", alignItems: "center", gap: 10, marginBottom: 8, fontSize: 13 }}>
                            <div style={{ width: 14, height: 14, background: colors[i % colors.length], borderRadius: 3 }} />
                            <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#333", minWidth: 150, maxWidth: 260 }}>{d.name}</div>
                            <div style={{ fontWeight: 700, color: "#666", minWidth: 40, textAlign: "right" }}>{Math.round(d.value / pieTotal * 100)}%</div>
                            <div style={{ fontSize: 11, color: "#888", minWidth: 90, textAlign: "right" }}>HKD${Math.round(d.value).toLocaleString()}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })()}
              {/* 产品 Top 10 + 客户 Top 10 */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <div style={{ background: "#fff", borderRadius: 14, padding: 24, border: "1px solid #f0f0f0" }}>
                  <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 700 }}>熱銷產品 Top 10</h3>
                  {prodTop.length === 0 ? <div style={{ color: "#aaa", fontSize: 13 }}>沒有數據</div> : prodTop.map(([name, amt]) => (
                    <div key={name} style={{ marginBottom: 10 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                        <span style={{ fontWeight: 600, color: "#333", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "70%" }}>{name}</span>
                        <span style={{ fontWeight: 700, color: "#6382ff" }}>HKD${Math.round(amt).toLocaleString()}</span>
                      </div>
                      <div style={{ height: 6, background: "#f0f4ff", borderRadius: 3 }}>
                        <div style={{ height: "100%", width: `${(amt/maxProd)*100}%`, background: "linear-gradient(90deg,#6382ff,#a78bfa)", borderRadius: 3 }} />
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ background: "#fff", borderRadius: 14, padding: 24, border: "1px solid #f0f0f0" }}>
                  <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 700 }}>大客戶 Top 10</h3>
                  {custTop.length === 0 ? <div style={{ color: "#aaa", fontSize: 13 }}>沒有數據</div> : custTop.map((c, idx) => (
                    <div key={idx} style={{ marginBottom: 10 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                        <span style={{ fontWeight: 600, color: "#333" }}>{c.name}{c.phone ? ` · ${c.phone}` : ""}</span>
                        <span style={{ fontWeight: 700, color: "#22c55e" }}>HKD${Math.round(c.amt).toLocaleString()}</span>
                      </div>
                      <div style={{ height: 6, background: "#f0fdf4", borderRadius: 3 }}>
                        <div style={{ height: "100%", width: `${(c.amt/maxCust)*100}%`, background: "linear-gradient(90deg,#22c55e,#84cc16)", borderRadius: 3 }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        })()}

        {/* EMPLOYEES — 員工管理 */}
        {tab === "employees" && !selectedEmployee && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 28 }}>
              <div>
                <div style={{ fontSize: 28, fontWeight: 800 }}>員工管理</div>
                <div style={{ fontSize: 13, color: "#888", marginTop: 4 }}>共 {employees.length} 位員工</div>
              </div>
              <button onClick={() => setShowAddEmployee(true)} style={{ display: "flex", alignItems: "center", gap: 6, background: "#6382ff", color: "#fff", border: "none", borderRadius: 10, padding: "10px 18px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
                <Icon name="plus" size={16} /> 新增員工
              </button>
            </div>
            {employees.length === 0 ? (
              <div style={{ background: "#fff", borderRadius: 14, padding: 48, textAlign: "center", color: "#999", border: "1px dashed #e0e0e0" }}>
                尚無員工，點右上「新增員工」開始。
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
                {employees.map(emp => {
                  const empTasks = tasks.filter(t => t.employee_id === emp.id && !t.parent_task_id);
                  const openCount = empTasks.filter(t => t.status === "open").length;
                  const doneCount = empTasks.filter(t => t.status === "done").length;
                  return (
                    <div key={emp.id} onClick={() => setSelectedEmployee(emp)} style={{ background: "#fff", borderRadius: 14, padding: "20px 22px", border: "1px solid #f0f0f0", cursor: "pointer", transition: "transform 0.15s, box-shadow 0.15s", boxShadow: "0 2px 8px rgba(0,0,0,0.03)" }}
                      onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 6px 16px rgba(0,0,0,0.08)"; }}
                      onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.03)"; }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                        <div style={{ width: 44, height: 44, borderRadius: "50%", background: "linear-gradient(135deg,#7c9dff,#a78bfa)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, fontWeight: 700 }}>{(emp.name || "?").slice(0, 1)}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 16, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{emp.name}</div>
                          {emp.role && <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>{emp.role}</div>}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 14, fontSize: 12, color: "#666" }}>
                        <div><span style={{ fontWeight: 700, color: "#6382ff" }}>{openCount}</span> 進行中</div>
                        <div><span style={{ fontWeight: 700, color: "#22c55e" }}>{doneCount}</span> 已完成</div>
                      </div>
                      {(emp.phone || emp.email) && (
                        <div style={{ fontSize: 11, color: "#aaa", marginTop: 10, paddingTop: 10, borderTop: "1px solid #f5f5f5" }}>
                          {emp.phone && <div>{emp.phone}</div>}
                          {emp.email && <div>{emp.email}</div>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* EMPLOYEE DETAIL BOARD — 員工任務看板 */}
        {tab === "employees" && selectedEmployee && (() => {
          const emp = selectedEmployee;
          const topTasks = tasks.filter(t => t.employee_id === emp.id && !t.parent_task_id);
          const cols = {
            high: topTasks.filter(t => t.priority === "high" && t.status === "open"),
            none: topTasks.filter(t => t.priority === "none" && t.status === "open"),
            abandoned: topTasks.filter(t => t.status === "abandoned"),
            done: topTasks.filter(t => t.status === "done"),
          };
          const renderTaskCard = (t, idx) => {
            const subtasks = tasks.filter(s => s.parent_task_id === t.id);
            const subDone = subtasks.filter(s => s.status === "done").length;
            const isDone = t.status === "done";
            const isAbandoned = t.status === "abandoned";
            return (
              <div key={t.id} style={{ background: "#fff", border: "1px solid #f0f0f0", borderRadius: 10, padding: "12px 14px", marginBottom: 8, opacity: (isDone || isAbandoned) ? 0.6 : 1, cursor: "pointer" }}
                onClick={(e) => { if (e.target.tagName !== "INPUT") setEditingTask(t); }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                  <input type="checkbox" checked={isDone} onChange={() => handleToggleTaskDone(t)} onClick={e => e.stopPropagation()} style={{ width: 16, height: 16, marginTop: 2, cursor: "pointer" }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, textDecoration: isDone ? "line-through" : "none", color: (isDone || isAbandoned) ? "#999" : "#222" }}>
                      {idx != null && <span style={{ color: "#aaa", marginRight: 6 }}>{idx + 1}.</span>}{t.title}
                    </div>
                    {(subtasks.length > 0 || t.feedback) && (
                      <div style={{ fontSize: 11, color: "#888", marginTop: 4, display: "flex", gap: 10 }}>
                        {subtasks.length > 0 && <span>☑ {subDone}/{subtasks.length} 子任務</span>}
                        {t.feedback && <span style={{ color: "#f59e0b" }}>💬 反饋</span>}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          };
          const AddTaskInput = ({ priority }) => {
            const [val, setVal] = useState("");
            return (
              <form onSubmit={e => { e.preventDefault(); if (val.trim()) { handleAddTask(emp.id, val, priority); setVal(""); } }} style={{ marginBottom: 10 }}>
                <input value={val} onChange={e => setVal(e.target.value)} placeholder="+ 添加任務" style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px dashed #d0d0d0", fontSize: 13, outline: "none", background: "#fafbff", boxSizing: "border-box" }} />
              </form>
            );
          };
          return (
            <div>
              <button onClick={() => setSelectedEmployee(null)} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#888", fontSize: 13, cursor: "pointer", marginBottom: 16, padding: 0 }}>
                <Icon name="back" size={14} /> 返回員工列表
              </button>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                  <div style={{ width: 56, height: 56, borderRadius: "50%", background: "linear-gradient(135deg,#7c9dff,#a78bfa)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, fontWeight: 700 }}>{(emp.name || "?").slice(0, 1)}</div>
                  <div>
                    <div style={{ fontSize: 24, fontWeight: 800 }}>{emp.name}</div>
                    <div style={{ fontSize: 13, color: "#888", marginTop: 2 }}>
                      {[emp.role, emp.phone, emp.email].filter(Boolean).join(" · ") || "—"}
                    </div>
                  </div>
                </div>
                <button onClick={() => handleDeleteEmployee(emp)} style={{ background: "#fce4ec", border: "none", color: "#e53935", borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>刪除員工</button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginBottom: 24 }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ color: "#ef4444" }}>高優先級</span>
                    <span style={{ fontSize: 12, color: "#aaa" }}>{cols.high.length}</span>
                  </div>
                  <AddTaskInput priority="high" />
                  {cols.high.map((t, i) => renderTaskCard(t, i))}
                </div>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
                    <span>無優先級</span>
                    <span style={{ fontSize: 12, color: "#aaa" }}>{cols.none.length}</span>
                  </div>
                  <AddTaskInput priority="none" />
                  {cols.none.map((t, i) => renderTaskCard(t, i))}
                </div>
              </div>
              {cols.abandoned.length > 0 && (
                <details style={{ marginBottom: 16 }}>
                  <summary style={{ fontSize: 14, fontWeight: 600, color: "#888", cursor: "pointer", padding: "8px 0" }}>
                    已放棄 <span style={{ color: "#aaa", marginLeft: 6 }}>{cols.abandoned.length}</span>
                  </summary>
                  <div style={{ marginTop: 8 }}>{cols.abandoned.map((t, i) => renderTaskCard(t, i))}</div>
                </details>
              )}
              {cols.done.length > 0 && (
                <details style={{ marginBottom: 16 }}>
                  <summary style={{ fontSize: 14, fontWeight: 600, color: "#22c55e", cursor: "pointer", padding: "8px 0" }}>
                    已完成 <span style={{ color: "#aaa", marginLeft: 6 }}>{cols.done.length}</span>
                  </summary>
                  <div style={{ marginTop: 8 }}>{cols.done.map((t, i) => renderTaskCard(t, i))}</div>
                </details>
              )}
            </div>
          );
        })()}
      </main>

      {/* PENDING MERGE PROMPT MODAL */}
      {pendingMerge && (() => {
        const { newCustomer: nc, oldCustomer: oc } = pendingMerge;
        const isEmpty = v => v == null || String(v).trim() === "";
        const rows = [
          ["姓名", "name"],
          ["香港電話", "phone"],
          ["內地電話", "phone_mainland"],
          ["郵箱", "email"],
          ["地址", "address"],
          ["車品牌", "car_make"],
          ["車型", "car_model"],
          ["推薦人", "referral"],
        ];
        return (
          <div onClick={() => !mergeBusy && setPendingMerge(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 2100, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
            <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: 28, width: 720, maxWidth: "100%", maxHeight: "90vh", overflowY: "auto", boxShadow: "0 10px 40px rgba(0,0,0,0.25)" }}>
              <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>🔔 疑似重複客戶，是否合併？</div>
              <div style={{ fontSize: 13, color: "#666", marginBottom: 18, lineHeight: 1.6 }}>
                此表單提交的新客戶匹配到原有客戶（姓名/電話/郵箱/地址命中 3 分以上）。<br/>
                合併邏輯：<b>原有資料不變</b>，只將老客戶空的欄位填入新表單值。帶 🆕 的是新客戶獨有的資訊。
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "100px 1fr 1fr 180px", gap: 0, border: "1px solid #eee", borderRadius: 10, overflow: "hidden", marginBottom: 18 }}>
                <div style={{ background: "#fafafa", padding: "10px 12px", fontSize: 12, fontWeight: 700, color: "#888" }}>欄位</div>
                <div style={{ background: "#fafafa", padding: "10px 12px", fontSize: 12, fontWeight: 700, color: "#888", borderLeft: "1px solid #eee" }}>原有客戶</div>
                <div style={{ background: "#fff9ec", padding: "10px 12px", fontSize: 12, fontWeight: 700, color: "#8a6900", borderLeft: "1px solid #eee" }}>新表單客戶</div>
                <div style={{ background: "#fafafa", padding: "10px 12px", fontSize: 12, fontWeight: 700, color: "#888", borderLeft: "1px solid #eee", textAlign: "center" }}>差異處理</div>
                {rows.map(([label, key]) => {
                  const oldVal = oc[key];
                  const newVal = nc[key];
                  const isNew = isEmpty(oldVal) && !isEmpty(newVal);
                  const isDiff = !isEmpty(oldVal) && !isEmpty(newVal) && String(oldVal).trim().toLowerCase() !== String(newVal).trim().toLowerCase();
                  const choice = mergeChoices[key] || "keep";
                  const btn = (val, label2) => (
                    <button
                      type="button"
                      onClick={() => setMergeChoices(p => ({ ...p, [key]: val }))}
                      style={{
                        flex: 1,
                        border: "1px solid " + (choice === val ? "#6382ff" : "#ddd"),
                        background: choice === val ? "#6382ff" : "#fff",
                        color: choice === val ? "#fff" : "#555",
                        fontSize: 10,
                        fontWeight: 700,
                        padding: "4px 0",
                        borderRadius: 5,
                        cursor: "pointer"
                      }}
                    >{label2}</button>
                  );
                  return (
                    <>
                      <div key={key+"-l"} style={{ padding: "10px 12px", fontSize: 13, fontWeight: 600, color: "#555", borderTop: "1px solid #eee" }}>{label}</div>
                      <div key={key+"-o"} style={{ padding: "10px 12px", fontSize: 13, color: isEmpty(oldVal) ? "#bbb" : "#111", borderLeft: "1px solid #eee", borderTop: "1px solid #eee" }}>
                        {isEmpty(oldVal) ? "—" : oldVal}
                      </div>
                      <div key={key+"-n"} style={{ padding: "10px 12px", fontSize: 13, color: isEmpty(newVal) ? "#bbb" : "#111", borderLeft: "1px solid #eee", borderTop: "1px solid #eee", display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ flex: 1 }}>{isEmpty(newVal) ? "—" : newVal}</span>
                        {isNew && <span style={{ background: "#d4edda", color: "#155724", fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 4 }}>🆕 NEW</span>}
                        {isDiff && <span style={{ background: "#f8d7da", color: "#721c24", fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 4 }}>差異</span>}
                      </div>
                      <div key={key+"-c"} style={{ padding: "6px 8px", borderLeft: "1px solid #eee", borderTop: "1px solid #eee", display: "flex", alignItems: "center", gap: 4 }}>
                        {isDiff ? (<>{btn("keep", "保留")}{btn("overwrite", "覆蓋")}{btn("append", "追加")}</>) : (<span style={{ flex: 1, textAlign: "center", color: "#bbb", fontSize: 11 }}>{isNew ? "自動補" : "—"}</span>)}
                      </div>
                    </>
                  );
                })}
              </div>
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <button disabled={mergeBusy} onClick={() => setPendingMerge(null)} style={{ background: "#f5f5f5", border: "none", borderRadius: 8, padding: "10px 18px", fontWeight: 600, cursor: mergeBusy ? "not-allowed" : "pointer" }}>關閉（下次再決定）</button>
                <button disabled={mergeBusy} onClick={handleConfirmMerge} style={{ background: mergeBusy ? "#ccc" : "#6382ff", color: "#fff", border: "none", borderRadius: 8, padding: "10px 18px", fontWeight: 700, cursor: mergeBusy ? "not-allowed" : "pointer" }}>
                  {mergeBusy ? "合併中…" : "合併到原客戶"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* MERGE HISTORY MODAL — 点"已合并 N 条"徽标弹出 */}
      {mergeHistoryOpen && (() => {
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
              <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>合併記錄</div>
              <div style={{ fontSize: 12, color: "#888", marginBottom: 16 }}>
                此客戶由 {rows.length} 條原始記錄組成（虛擬：字段命中 3+ 自動合併；物理：除名字外完全相等已合併到主記錄）
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
                            title="回退：從合併組分離、改合併到其他客戶、或恢復字段值"
                            style={{ fontSize: 12, background: "#fff0f0", color: "#d14343", border: "1px solid #ffcccc", borderRadius: 6, padding: "5px 10px", cursor: "pointer", fontWeight: 600 }}
                          >回退</button>
                        )}
                        <span style={{ fontWeight: 700, fontSize: 14 }}>{real.name || "(無名)"}</span>
                        {isPrimary && <span style={{ fontSize: 10, color: "#2b4eb5", background: "#e0e8ff", borderRadius: 4, padding: "2px 6px", fontWeight: 700 }}>主記錄</span>}
                        {isPhysicalChild && <span style={{ fontSize: 10, color: "#8a6900", background: "#fde8b0", borderRadius: 4, padding: "2px 6px", fontWeight: 700 }}>物理合併</span>}
                      </div>
                    </div>
                    <div style={{ fontSize: 12, color: "#666", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
                      <div>📱 香港：{real.phone || "—"}</div>
                      <div>📧 {real.email || "—"}</div>
                      {real.phone_mainland && <div>📱 內地：{real.phone_mainland}</div>}
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
                      title="把 rule 1 虛擬合併的成員真正綁定到主記錄，之後刪除字段才真生效"
                      style={{ background: "#fff6e5", color: "#b87500", border: "1px solid #ffd88a", borderRadius: 8, padding: "10px 16px", fontWeight: 700, cursor: "pointer", fontSize: 13 }}
                    >升級為物理合併 ({upgradeable})</button>
                  );
                })()}
                <button onClick={() => setMergeHistoryOpen(null)} style={{ background: "#f5f5f5", border: "none", borderRadius: 8, padding: "10px 18px", fontWeight: 600, cursor: "pointer" }}>關閉</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ROLLBACK MODAL — 從合併記錄 modal 點「回退」打開 */}
      {rollbackOpen && (() => {
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
          { dbKey: "phone", label: "香港電話" },
          { dbKey: "phone_mainland", label: "內地電話" },
          { dbKey: "email", label: "郵箱" },
          { dbKey: "address", label: "地址" },
          { dbKey: "car_make", label: "車品牌" },
          { dbKey: "car_model", label: "車型" },
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
              <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>回退合併</div>
              <div style={{ fontSize: 12, color: "#888", marginBottom: 18 }}>
                主記錄：<b>{primaryRec?.name || "(無名)"}</b>（id: {primaryCid.slice(0,8)}…）<br/>
                點擊的記錄：<b>{clickedRec?.name || "(無名)"}</b>（id: {clickedCid.slice(0,8)}…）
              </div>

              {/* 影響範圍 */}
              <div style={{ marginBottom: 18 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#333", marginBottom: 8 }}>1. 影響範圍（勾選要一併回退的記錄）</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 180, overflowY: "auto", border: "1px solid #eee", borderRadius: 8, padding: 10 }}>
                  {records.map(r => {
                    const checked = rollbackAffected.has(r.id);
                    const isPhys = Boolean(r.parent_id);
                    return (
                      <label key={r.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", border: "1px solid " + (checked ? "#6382ff" : "#eee"), background: checked ? "#f0f4ff" : "#fff", borderRadius: 6, cursor: "pointer", fontSize: 12 }}>
                        <input type="checkbox" checked={checked} onChange={() => toggleAffected(r.id)} />
                        <span style={{ fontWeight: 600 }}>{r.name || "(無名)"}</span>
                        <span style={{ fontSize: 10, color: isPhys ? "#8a6900" : "#2b4eb5", background: isPhys ? "#fde8b0" : "#e0e8ff", borderRadius: 4, padding: "1px 6px", fontWeight: 700 }}>{isPhys ? "物理子" : "rule 1 獨立"}</span>
                        <span style={{ color: "#888" }}>{r.phone || "—"} · {r.email || "—"}</span>
                        <span style={{ color: "#aaa", marginLeft: "auto" }}>id: {r.id.slice(0,8)}…</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* 目標 */}
              <div style={{ marginBottom: 18 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#333", marginBottom: 8 }}>2. 回退後的目標</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", border: "1px solid " + (rollbackTarget === "independent" ? "#6382ff" : "#e0e0e0"), background: rollbackTarget === "independent" ? "#f0f4ff" : "#fff", borderRadius: 8, cursor: "pointer" }}>
                    <input type="radio" checked={rollbackTarget === "independent"} onChange={() => setRollbackTarget("independent")} />
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>變為獨立客戶</div>
                      <div style={{ fontSize: 11, color: "#888" }}>物理子記錄會清 parent_id；rule 1 獨立會加入 merge_exclude 不再自動合併回主記錄</div>
                    </div>
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", border: "1px solid " + (rollbackTarget === "mergeTo" ? "#6382ff" : "#e0e0e0"), background: rollbackTarget === "mergeTo" ? "#f0f4ff" : "#fff", borderRadius: 8, cursor: "pointer" }}>
                    <input type="radio" checked={rollbackTarget === "mergeTo"} onChange={() => setRollbackTarget("mergeTo")} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>合併到其他客戶</div>
                      <div style={{ fontSize: 11, color: "#888", marginBottom: rollbackTarget === "mergeTo" ? 6 : 0 }}>所選記錄 UPDATE parent_id = 目標客戶</div>
                      {rollbackTarget === "mergeTo" && (
                        <div style={{ position: "relative" }}>
                          <input
                            value={rollbackMergeToQuery}
                            onChange={e => { setRollbackMergeToQuery(e.target.value); setRollbackMergeToOpen(true); if (rollbackMergeTo) setRollbackMergeTo(""); }}
                            onFocus={() => setRollbackMergeToOpen(true)}
                            onBlur={() => setTimeout(() => setRollbackMergeToOpen(false), 150)}
                            placeholder="輸入客戶姓名 / 電話 / 郵箱..."
                            style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid " + (rollbackMergeTo ? "#6382ff" : "#e0e0e0"), fontSize: 13, outline: "none", boxSizing: "border-box" }}
                          />
                          {rollbackMergeToOpen && rollbackMergeToQuery && (
                            <div style={{ position: "absolute", top: "calc(100% + 2px)", left: 0, right: 0, maxHeight: 200, overflowY: "auto", background: "#fff", border: "1px solid #e0e0e0", borderRadius: 8, boxShadow: "0 4px 12px rgba(0,0,0,0.08)", zIndex: 10 }}>
                              {mergeToCandidates.length === 0 ? (
                                <div style={{ padding: "8px 12px", fontSize: 12, color: "#999" }}>沒找到</div>
                              ) : mergeToCandidates.map(v => (
                                <div key={v.id} onMouseDown={() => { setRollbackMergeTo(v.id); setRollbackMergeToQuery(`${v.name || "(無名)"} · ${v.phone || "—"}`); setRollbackMergeToOpen(false); }}
                                  style={{ padding: "7px 12px", fontSize: 12, cursor: "pointer", borderBottom: "1px solid #f5f5f5" }}
                                  onMouseEnter={e => e.currentTarget.style.background = "#f8f9ff"}
                                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                                  <div style={{ fontWeight: 600 }}>{v.name || "(無名)"}</div>
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
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#333", marginBottom: 4 }}>3. 字段恢復（僅對點擊的記錄 {clickedRec.name || "(無名)"}）</div>
                  <div style={{ fontSize: 11, color: "#888", marginBottom: 10 }}>可選：從合併組其他成員的字段池裡挑值覆蓋。選「不修改」保留當前值。</div>
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
                            <option value="">-- 不修改（當前：{cur ? String(cur).slice(0, 30) + (String(cur).length > 30 ? "…" : "") : "空"}）--</option>
                            {vals.map(v => <option key={v} value={v}>{v.slice(0, 60)}{v.length > 60 ? "…" : ""}</option>)}
                            <option value="__clear__">-- 清空 --</option>
                          </select>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 按鈕 */}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                <button onClick={() => !rollbackBusy && setRollbackOpen(null)} disabled={rollbackBusy} style={{ background: "#f5f5f5", border: "none", borderRadius: 8, padding: "10px 18px", fontWeight: 600, cursor: rollbackBusy ? "not-allowed" : "pointer" }}>取消</button>
                <button onClick={handleRollback} disabled={rollbackBusy} style={{ background: rollbackBusy ? "#ccc" : "#d14343", color: "#fff", border: "none", borderRadius: 8, padding: "10px 18px", fontWeight: 700, cursor: rollbackBusy ? "not-allowed" : "pointer" }}>{rollbackBusy ? "執行中..." : "確認回退"}</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* MERGE CANDIDATES MODAL — 客户页一键入口 */}
      {mergeCandidatesOpen && (() => {
        const candidates = customerGroups.virtualCustomers
          .filter(v => (v.groupCids || []).length > 1)
          .sort((a, b) => (b.groupCids?.length || 0) - (a.groupCids?.length || 0));
        return (
          <div onClick={() => setMergeCandidatesOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
            <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: 28, width: 760, maxWidth: "100%", maxHeight: "90vh", overflowY: "auto", boxShadow: "0 10px 40px rgba(0,0,0,0.25)" }}>
              <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>疑似重複客戶檢測</div>
              <div style={{ fontSize: 12, color: "#888", marginBottom: 16 }}>
                共 {candidates.length} 組虛擬合併（資料命中 3+ 字段自動合併）。點「物理合併」把成員綁定到主記錄，之後刪字段才真生效。
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {candidates.length === 0 && (
                  <div style={{ textAlign: "center", color: "#aaa", padding: 30, fontSize: 13 }}>沒有疑似重複的客戶</div>
                )}
                {candidates.map(vc => {
                  const siblingCount = (vc.groupCids || []).filter(id => id !== vc.id).length;
                  const preview = [vc.phone, vc.email, splitMulti(vc.car_make)[0]].filter(Boolean).join(" · ");
                  return (
                    <div key={vc.id} style={{ border: "1px solid #eee", borderRadius: 10, padding: "12px 14px", background: "#fafbff", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2, display: "flex", alignItems: "center", gap: 6 }}>
                          {vc.name || "(無名)"}
                          <span style={{ fontSize: 10, color: "#6382ff", background: "#eef2ff", borderRadius: 20, padding: "1px 8px", fontWeight: 700 }}>合併組 {vc.groupCids.length} 條</span>
                        </div>
                        <div style={{ fontSize: 12, color: "#666", marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{preview || "—"}</div>
                        {vc.allNames && vc.allNames.length > 1 && (
                          <div style={{ fontSize: 11, color: "#888" }}>別名：{vc.allNames.filter(n => n !== vc.name).join(" / ")}</div>
                        )}
                      </div>
                      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                        <button
                          onClick={() => { setMergeCandidatesOpen(false); setSelectedCustomer(vc); }}
                          style={{ fontSize: 12, background: "#f5f5f5", color: "#666", border: "none", borderRadius: 6, padding: "7px 12px", cursor: "pointer", fontWeight: 600 }}
                        >查看</button>
                        <button
                          onClick={() => handleUpgradePhysical(vc)}
                          style={{ fontSize: 12, background: "#6382ff", color: "#fff", border: "none", borderRadius: 6, padding: "7px 12px", cursor: "pointer", fontWeight: 700, whiteSpace: "nowrap" }}
                        >物理合併 {siblingCount}</button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}>
                <button onClick={() => setMergeCandidatesOpen(false)} style={{ background: "#f5f5f5", border: "none", borderRadius: 8, padding: "10px 18px", fontWeight: 600, cursor: "pointer" }}>關閉</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* EDIT CUSTOMER MODAL */}
      {editingCustomer && (() => {
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
        const multiFld = (label, key, placeholder, addText) => {
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
              {arr.map((v, idx) => (
                <div key={idx} style={{ display: "flex", gap: 6 }}>
                  <input
                    type="text"
                    value={v}
                    placeholder={placeholder}
                    onChange={e => updateAt(idx, e.target.value)}
                    style={{ flex: 1, padding: "8px 10px", border: "1px solid #e0e0e0", borderRadius: 8, fontSize: 14, color: "#111" }}
                  />
                  {arr.length > 1 && (
                    <button type="button" onClick={() => removeAt(idx)} title="刪除" style={{ width: 34, background: "#fff0f0", color: "#d14343", border: "1px solid #ffcccc", borderRadius: 8, cursor: "pointer", fontWeight: 700 }}>×</button>
                  )}
                </div>
              ))}
              <button type="button" onClick={addNew} style={{ alignSelf: "flex-start", background: "none", color: "#6382ff", border: "1px dashed #6382ff", borderRadius: 8, padding: "5px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>+ {addText}</button>
            </div>
          );
        };
        return (
          <div onClick={() => !editCustSaving && setEditingCustomer(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
            <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: 28, width: 620, maxWidth: "100%", maxHeight: "90vh", overflowY: "auto", boxShadow: "0 10px 40px rgba(0,0,0,0.2)" }}>
              <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>編輯客戶資料</div>
              <div style={{ fontSize: 12, color: "#888", marginBottom: 16 }}>id: {editCustCid}</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
                {inp("姓名 Name", "name")}
                <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "#666", fontWeight: 600 }}>
                  類型 Type
                  <select value={editCustForm.type} onChange={e => setEditCustForm(f => ({ ...f, type: e.target.value }))} style={{ padding: "8px 10px", border: "1px solid #e0e0e0", borderRadius: 8, fontSize: 14, color: "#111", background: "#fff" }}>
                    <option value="Regular">Regular</option>
                    <option value="Lead">Lead</option>
                  </select>
                </label>
              </div>
              <div style={{ marginBottom: 14 }}>
                {multiFld("別名 Aliases", "aliases", "例：公司別名或其他稱呼", "新增別名")}
              </div>
              <div style={{ marginBottom: 14 }}>
                {inp("推薦人 Referral", "referral")}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
                {multiFld("香港電話 Phone", "phones", "例：9123 4567", "新增香港電話")}
                {multiFld("內地電話 Phone (CN)", "phoneMainlands", "例：138 0013 8000", "新增內地電話")}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
                {multiFld("郵箱 Email", "emails", "例：user@example.com", "新增郵箱")}
                {multiFld("車品牌 Car Make", "carMakes", "例：Tesla", "新增車品牌")}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
                {multiFld("車型 Car Model", "carModels", "例：Model 3", "新增車型")}
                <div />
              </div>
              <div style={{ marginBottom: 18 }}>
                {multiFld("地址 Address", "addresses", "請輸入完整地址", "新增地址")}
              </div>
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <button disabled={editCustSaving} onClick={() => setEditingCustomer(null)} style={{ background: "#f5f5f5", border: "none", borderRadius: 8, padding: "10px 18px", fontWeight: 600, cursor: editCustSaving ? "not-allowed" : "pointer" }}>取消</button>
                <button disabled={editCustSaving} onClick={handleSaveCustomerEdit} style={{ background: editCustSaving ? "#ccc" : "#6382ff", color: "#fff", border: "none", borderRadius: 8, padding: "10px 18px", fontWeight: 700, cursor: editCustSaving ? "not-allowed" : "pointer" }}>
                  {editCustSaving ? "保存中…" : "保存"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* PRINT FIELD CHOOSER — 客户任一字段多值时先挑一组 */}
      {printFieldChooser && (() => {
        const labels = Object.fromEntries(PRINT_FIELD_DEFS.map(d => [d.key, d.label]));
        const { multi } = printFieldChooser;
        return (
          <div onClick={() => setPrintFieldChooser(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 2050, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
            <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: 28, width: 520, maxWidth: "100%", maxHeight: "90vh", overflowY: "auto", boxShadow: "0 10px 40px rgba(0,0,0,0.25)" }}>
              <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>選擇本次列印使用的資訊</div>
              <div style={{ fontSize: 12, color: "#888", marginBottom: 18 }}>此客戶在以下欄位存了多個值，請勾選本張發票/收據使用哪個。</div>
              {Object.keys(multi).map(field => (
                <div key={field} style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#555", marginBottom: 8 }}>{labels[field] || field}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {multi[field].map((v, idx) => (
                      <label key={idx} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 12px", border: "1px solid " + (printFieldChoices[field] === v ? "#6382ff" : "#eee"), background: printFieldChoices[field] === v ? "#f0f4ff" : "#fff", borderRadius: 10, cursor: "pointer" }}>
                        <input type="radio" name={"pfc-"+field} checked={printFieldChoices[field] === v} onChange={() => setPrintFieldChoices(p => ({ ...p, [field]: v }))} style={{ marginTop: 3 }} />
                        <span style={{ fontSize: 14, color: "#111", whiteSpace: "pre-wrap", lineHeight: 1.4 }}>{v}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 20 }}>
                <button onClick={() => setPrintFieldChooser(null)} style={{ background: "#f5f5f5", border: "none", borderRadius: 8, padding: "10px 18px", fontWeight: 600, cursor: "pointer" }}>取消</button>
                <button
                  onClick={() => {
                    const { inv, customer, items, products } = printFieldChooser;
                    const override = { ...customer, ...printFieldChoices };
                    setPrintFieldChooser(null);
                    setPrintWantInvoice(true);
                    setPrintWantReceipt(true);
                    setPrintChooser({ inv, customer: override, items, products });
                  }}
                  style={{ background: "#6382ff", color: "#fff", border: "none", borderRadius: 8, padding: "10px 18px", fontWeight: 700, cursor: "pointer" }}
                >下一步</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* PRINT CHOOSER MODAL */}
      {printChooser && (
        <div onClick={() => setPrintChooser(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: 28, width: 360, maxWidth: "90vw", boxShadow: "0 10px 40px rgba(0,0,0,0.2)" }}>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>選擇列印內容</div>
            <div style={{ fontSize: 13, color: "#888", marginBottom: 18 }}>
              DC{String(printChooser.inv.invoice_number || "").replace(/^DC/i, "") || (printChooser.inv.id || "").slice(0, 8)}
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", border: "1px solid #eee", borderRadius: 10, marginBottom: 10, cursor: "pointer" }}>
              <input type="checkbox" checked={printWantInvoice} onChange={e => setPrintWantInvoice(e.target.checked)} style={{ width: 16, height: 16 }} />
              <span style={{ fontWeight: 600 }}>發票 Invoice</span>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", border: "1px solid #eee", borderRadius: 10, marginBottom: 18, cursor: "pointer" }}>
              <input type="checkbox" checked={printWantReceipt} onChange={e => setPrintWantReceipt(e.target.checked)} style={{ width: 16, height: 16 }} />
              <span style={{ fontWeight: 600 }}>收據 Receipt</span>
            </label>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button onClick={() => setPrintChooser(null)} style={{ background: "#f5f5f5", border: "none", borderRadius: 8, padding: "10px 18px", fontWeight: 600, cursor: "pointer" }}>取消</button>
              <button
                disabled={!printWantInvoice && !printWantReceipt}
                onClick={() => {
                  const { inv, customer, items, products } = printChooser;
                  setPrintChooser(null);
                  printInvoice(inv, customer, items, products, { invoice: printWantInvoice, receipt: printWantReceipt });
                }}
                style={{ background: (!printWantInvoice && !printWantReceipt) ? "#ccc" : "#6382ff", color: "#fff", border: "none", borderRadius: 8, padding: "10px 18px", fontWeight: 700, cursor: (!printWantInvoice && !printWantReceipt) ? "not-allowed" : "pointer" }}
              >確定列印</button>
            </div>
          </div>
        </div>
      )}

      {/* ADD CUSTOMER MODAL */}
      {editingInvoice && (() => {
        const itemsSubtotal = editInvItems.reduce((s, it) => s + (Number(it.price) || 0) * (Number(it.qty) || 0), 0);
        const extrasTotal =
          (editInvExtras.deposit?.enabled ? (Number(editInvExtras.deposit.amount) || 0) : 0) +
          (editInvExtras.surcharge?.enabled ? (Number(editInvExtras.surcharge.amount) || 0) : 0) -
          (editInvExtras.discount?.enabled ? (Number(editInvExtras.discount.amount) || 0) : 0);
        const itemsSum = itemsSubtotal + extrasTotal;
        const finalTotal = editInvTotalOverride === "" ? itemsSum : (Number(editInvTotalOverride) || 0);
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
            <div style={{ background: "#fff", borderRadius: 20, padding: 32, width: 700, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>編輯發票</h2>
                  <div style={{ fontSize: 12, color: "#888", marginTop: 4 }}>#{editingInvoice.invoice_number || editingInvoice.id}</div>
                </div>
                <button onClick={closeEditInvoice} style={{ background: "#f5f5f5", border: "none", borderRadius: 8, padding: "6px 10px", cursor: "pointer" }}><Icon name="x" size={16} /></button>
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 13, fontWeight: 700, color: "#555", display: "block", marginBottom: 8 }}>明細</label>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 56px 90px 72px 36px", gap: 6, fontSize: 11, color: "#888", marginBottom: 6, paddingLeft: 4 }}>
                  <div>產品名稱</div><div style={{ textAlign: "center" }}>數量</div><div>單價 HKD</div><div>倉庫</div><div></div>
                </div>
                {editInvItems.map((item, idx) => (
                  <div key={item.id} style={{ display: "grid", gridTemplateColumns: "1fr 56px 90px 72px 36px", gap: 6, marginBottom: 8 }}>
                    <input value={item.name} onChange={e => { const arr = [...editInvItems]; arr[idx] = { ...item, name: e.target.value }; setEditInvItems(arr); }} placeholder="產品名" style={{ padding: "9px 12px", borderRadius: 10, border: "1px solid #e0e0e0", fontSize: 14, outline: "none" }} />
                    <input type="number" value={item.qty} onChange={e => { const arr = [...editInvItems]; arr[idx] = { ...item, qty: parseInt(e.target.value) || 0 }; setEditInvItems(arr); }} style={{ padding: "9px 12px", borderRadius: 10, border: "1px solid #e0e0e0", fontSize: 14, outline: "none", textAlign: "center" }} />
                    <input type="number" value={item.price} onChange={e => { const arr = [...editInvItems]; arr[idx] = { ...item, price: parseFloat(e.target.value) || 0 }; setEditInvItems(arr); }} style={{ padding: "9px 12px", borderRadius: 10, border: "1px solid #e0e0e0", fontSize: 14, outline: "none" }} />
                    <select value={item.warehouse_id || ''} onChange={e => { const arr = [...editInvItems]; arr[idx] = { ...item, warehouse_id: e.target.value || null }; setEditInvItems(arr); }} title="扣庫存的倉庫（不顯示在發票/收據上）" style={{ padding: "9px 6px", borderRadius: 10, border: "1px solid #e0e0e0", fontSize: 13, outline: "none", background: "#fff" }}>
                      <option value="">—</option>
                      {warehouses.map(w => <option key={w.id} value={w.id}>{w.name.replace("分部", "")}</option>)}
                    </select>
                    <button onClick={() => setEditInvItems(editInvItems.filter(i => i.id !== item.id))} style={{ background: "#fce4ec", border: "none", borderRadius: 8, cursor: "pointer", color: "#e53935" }}><Icon name="x" size={13} /></button>
                  </div>
                ))}
                <button onClick={() => setEditInvItems([...editInvItems, mkItem(warehouses[0]?.id)])} style={{ fontSize: 13, color: "#6382ff", background: "none", border: "1px dashed #6382ff", borderRadius: 8, padding: "8px 16px", cursor: "pointer", width: "100%", marginTop: 4 }}>+ 新增項目</button>
              </div>
              <div style={{ marginBottom: 14, padding: "14px 16px", background: "#fafbff", borderRadius: 12, border: "1px solid #eef0fa" }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#555", marginBottom: 10 }}>額外費用</div>
                {[
                  { key: "deposit", label: "押金", sign: "+", color: "#6382ff" },
                  { key: "discount", label: "優惠", sign: "−", color: "#d14343" },
                  { key: "surcharge", label: "手續費", sign: "+", color: "#f59e0b" },
                ].map(({ key, label, sign, color }) => {
                  const v = editInvExtras[key] || { enabled: false, amount: 0 };
                  return (
                    <div key={key} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                      <input type="checkbox" id={`edit-extra-${key}`} checked={v.enabled} onChange={e => setEditInvExtras({ ...editInvExtras, [key]: { ...v, enabled: e.target.checked } })} style={{ width: 16, height: 16, cursor: "pointer" }} />
                      <label htmlFor={`edit-extra-${key}`} style={{ fontSize: 14, cursor: "pointer", minWidth: 70, fontWeight: 600 }}>
                        <span style={{ color, marginRight: 4 }}>{sign}</span>{label}
                      </label>
                      {v.enabled && (
                        <input type="number" min="0" value={v.amount || ""} onChange={e => setEditInvExtras({ ...editInvExtras, [key]: { ...v, amount: parseFloat(e.target.value) || 0 } })} placeholder="金額 HKD" style={{ flex: 1, padding: "7px 12px", borderRadius: 8, border: "1px solid #e0e0e0", fontSize: 14, outline: "none" }} />
                      )}
                    </div>
                  );
                })}
              </div>
              <div style={{ background: "#fafbff", borderRadius: 12, padding: "14px 18px", marginBottom: 16, border: "1px solid #eef0fa" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, marginBottom: 8 }}>
                  <span style={{ color: "#666" }}>明細合計（含額外費用）</span>
                  <span style={{ fontWeight: 700 }}>HKD${Math.round(itemsSum).toLocaleString()}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 13, color: "#666" }}>發票總額（留空=跟明細）</span>
                  <input type="number" value={editInvTotalOverride} onChange={e => setEditInvTotalOverride(e.target.value)} placeholder={String(Math.round(itemsSum))} style={{ width: 160, padding: "8px 12px", borderRadius: 8, border: "1px solid #e0e0e0", fontSize: 14, outline: "none", textAlign: "right" }} />
                </div>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 20px", background: "#1a1a2e", borderRadius: 12, marginBottom: 16 }}>
                <span style={{ color: "#aaa", fontSize: 14 }}>最終總額</span>
                <span style={{ color: "#fff", fontSize: 22, fontWeight: 800 }}>HKD${Math.round(finalTotal).toLocaleString()}</span>
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={closeEditInvoice} style={{ flex: 1, padding: 12, background: "#f5f5f5", color: "#555", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: "pointer" }}>取消</button>
                <button onClick={handleSaveInvoice} style={{ flex: 2, padding: 12, background: "#6382ff", color: "#fff", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 800, cursor: "pointer" }}>儲存修改</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* MARK PAID CONFIRM MODAL */}
      {markPaidCtx && (() => {
        const { inv, defaultWh } = markPaidCtx;
        const plan = buildDeductionPlan(inv, defaultWh);
        let itemsArr = inv.items;
        if (typeof itemsArr === "string") { try { itemsArr = JSON.parse(itemsArr); } catch { itemsArr = []; } }
        if (!Array.isArray(itemsArr)) itemsArr = [];
        const anyMissing = itemsArr.some(it => !it.warehouse_id);
        const insufficient = plan.filter(p => !p.skip && p.after < 0);
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200 }}>
            <div style={{ background: "#fff", borderRadius: 16, padding: 24, width: 520, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
              <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 4 }}>標記已付款</div>
              <div style={{ fontSize: 12, color: "#888", marginBottom: 16 }}>#{inv.invoice_number || inv.id} · 將從庫存扣除對應數量</div>
              {anyMissing && (
                <div style={{ marginBottom: 14, padding: "12px 14px", background: "#fff8e1", borderRadius: 10, border: "1px solid #f4dca4" }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#8a6900", marginBottom: 8 }}>此發票有商品未指定倉庫，統一扣：</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    {warehouses.map(w => (
                      <button key={w.id} onClick={() => setMarkPaidCtx({ ...markPaidCtx, defaultWh: w.id })}
                        style={{ flex: 1, padding: "9px 12px", borderRadius: 8, border: defaultWh === w.id ? "2px solid #6382ff" : "1px solid #e0e0e0", background: defaultWh === w.id ? "#eef2ff" : "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer", color: defaultWh === w.id ? "#3b58d4" : "#555" }}>
                        {w.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div style={{ border: "1px solid #eef0fa", borderRadius: 10, overflow: "hidden", marginBottom: 14 }}>
                <div style={{ background: "#fafbff", padding: "8px 12px", fontSize: 11, color: "#888", display: "grid", gridTemplateColumns: "1fr 48px 60px 72px", gap: 6 }}>
                  <div>產品</div><div style={{ textAlign: "center" }}>數量</div><div>倉庫</div><div style={{ textAlign: "right" }}>扣後</div>
                </div>
                {plan.map((p, i) => {
                  const wh = warehouses.find(w => w.id === p.warehouse_id);
                  return (
                    <div key={i} style={{ padding: "9px 12px", fontSize: 12, borderTop: "1px solid #f5f5f5", display: "grid", gridTemplateColumns: "1fr 48px 60px 72px", gap: 6, alignItems: "center", background: p.skip ? "#fafafa" : (p.after < 0 ? "#fff5f5" : "#fff") }}>
                      <div style={{ color: p.skip ? "#999" : "#222", fontStyle: p.skip ? "italic" : "normal" }}>{p.name || "(空)"}</div>
                      <div style={{ textAlign: "center", color: "#555" }}>{p.qty}</div>
                      <div style={{ color: "#666", fontSize: 11 }}>{p.skip ? "—" : (wh ? wh.name.replace("分部", "") : "？")}</div>
                      <div style={{ textAlign: "right", fontWeight: 700, color: p.skip ? "#999" : (p.after < 0 ? "#e53935" : "#22c55e") }}>
                        {p.skip ? p.reason : `${p.current} → ${p.after}`}
                      </div>
                    </div>
                  );
                })}
              </div>
              {insufficient.length > 0 && (
                <div style={{ marginBottom: 14, padding: "10px 14px", background: "#fff5f5", borderRadius: 10, border: "1px solid #f4c4c4", fontSize: 12, color: "#c53030" }}>
                  ⚠ 以下商品庫存不足，確認後將扣成負數：
                  <div style={{ marginTop: 4, fontSize: 11 }}>
                    {insufficient.map((p, i) => <div key={i}>• {p.name}：剩 {p.current}，需扣 {p.qty}</div>)}
                  </div>
                </div>
              )}
              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={() => setMarkPaidCtx(null)} style={{ flex: 1, padding: 10, background: "#f5f5f5", color: "#555", border: "none", borderRadius: 10, fontWeight: 700, cursor: "pointer" }}>取消</button>
                <button onClick={executeMarkPaid} disabled={anyMissing && !defaultWh} style={{ flex: 2, padding: 10, background: (anyMissing && !defaultWh) ? "#e0e0e0" : "#22c55e", color: "#fff", border: "none", borderRadius: 10, fontWeight: 800, cursor: (anyMissing && !defaultWh) ? "not-allowed" : "pointer" }}>確認付款並扣庫存</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* STOCK OUT TOAST (bottom-right) */}
      {stockToast && (
        <div style={{ position: "fixed", right: 28, bottom: 28, width: 440, background: "#fff", borderRadius: 14, boxShadow: "0 10px 32px rgba(0,0,0,0.18)", border: "1px solid #f4c4c4", padding: "18px 18px 18px 20px", zIndex: 300, display: "flex", gap: 14, alignItems: "flex-start" }}>
          <div style={{ fontSize: 26, color: "#ef4444", lineHeight: 1, marginTop: 2 }}>⚠</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4 }}>庫存不足提醒</div>
            <div style={{ fontSize: 13, color: "#888", marginBottom: 10 }}>以下 {stockToast.items.length} 個 SKU 庫存為 0 或負數</div>
            <div style={{ fontSize: 13, color: "#333", maxHeight: 200, overflowY: "auto", lineHeight: 1.7 }}>
              {stockToast.items.slice(0, 10).map((n, i) => <div key={i} style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>• {n}</div>)}
              {stockToast.items.length > 10 && <div style={{ color: "#999", marginTop: 4 }}>... 還有 {stockToast.items.length - 10} 個</div>}
            </div>
          </div>
          <button onClick={() => setStockToast(null)} title="關閉" style={{ background: "none", border: "none", color: "#aaa", cursor: "pointer", fontSize: 24, padding: 0, lineHeight: 1, marginTop: -4 }}>×</button>
        </div>
      )}

      {/* ADD EMPLOYEE MODAL */}
      {showAddEmployee && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
          <div style={{ background: "#fff", borderRadius: 16, padding: 28, width: 460, boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>新增員工</h2>
              <button onClick={() => { setShowAddEmployee(false); setNewEmployee({ name: "", role: "", phone: "", email: "", note: "" }); }} style={{ background: "#f5f5f5", border: "none", borderRadius: 8, padding: "6px 10px", cursor: "pointer" }}><Icon name="x" size={16} /></button>
            </div>
            <Input label="姓名 *" value={newEmployee.name} onChange={v => setNewEmployee({ ...newEmployee, name: v })} placeholder="員工姓名" />
            <Input label="職位" value={newEmployee.role} onChange={v => setNewEmployee({ ...newEmployee, role: v })} placeholder="例如 客服 / 技術 / 銷售" />
            <Input label="電話" value={newEmployee.phone} onChange={v => setNewEmployee({ ...newEmployee, phone: v })} placeholder="+852" />
            <Input label="Email" value={newEmployee.email} onChange={v => setNewEmployee({ ...newEmployee, email: v })} placeholder="email@example.com" />
            <Input label="備註" value={newEmployee.note} onChange={v => setNewEmployee({ ...newEmployee, note: v })} placeholder="其他備註..." />
            <button onClick={handleSaveEmployee} disabled={!newEmployee.name.trim()} style={{ width: "100%", padding: 12, background: newEmployee.name.trim() ? "#6382ff" : "#e0e0e0", color: "#fff", border: "none", borderRadius: 10, fontSize: 15, fontWeight: 800, cursor: newEmployee.name.trim() ? "pointer" : "not-allowed", marginTop: 8 }}>儲存員工</button>
          </div>
        </div>
      )}

      {/* TASK DETAIL MODAL */}
      {editingTask && (() => {
        const t = editingTask;
        const subtasks = tasks.filter(s => s.parent_task_id === t.id);
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 110 }}>
            <div style={{ background: "#fff", borderRadius: 16, padding: 28, width: 540, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => handleUpdateTask(t.id, { priority: t.priority === "high" ? "none" : "high" })} style={{ fontSize: 12, fontWeight: 700, padding: "5px 12px", borderRadius: 20, border: "1px solid " + (t.priority === "high" ? "#ef4444" : "#e0e0e0"), background: t.priority === "high" ? "#fff5f5" : "#fff", color: t.priority === "high" ? "#ef4444" : "#888", cursor: "pointer" }}>
                    {t.priority === "high" ? "● 高優先級" : "○ 無優先級"}
                  </button>
                  {t.status !== "abandoned" && <button onClick={() => handleUpdateTask(t.id, { status: "abandoned" })} style={{ fontSize: 12, padding: "5px 12px", borderRadius: 20, border: "1px solid #e0e0e0", background: "#fff", color: "#888", cursor: "pointer" }}>標記放棄</button>}
                  {t.status === "abandoned" && <button onClick={() => handleUpdateTask(t.id, { status: "open" })} style={{ fontSize: 12, padding: "5px 12px", borderRadius: 20, border: "1px solid #6382ff", background: "#eef2ff", color: "#6382ff", cursor: "pointer" }}>恢復進行</button>}
                </div>
                <button onClick={() => setEditingTask(null)} style={{ background: "#f5f5f5", border: "none", borderRadius: 8, padding: "6px 10px", cursor: "pointer" }}><Icon name="x" size={16} /></button>
              </div>
              <input value={t.title} onChange={e => setEditingTask({ ...t, title: e.target.value })} onBlur={() => handleUpdateTask(t.id, { title: t.title })} style={{ width: "100%", padding: "10px 0", fontSize: 22, fontWeight: 800, border: "none", outline: "none", marginBottom: 4, boxSizing: "border-box" }} />
              <div style={{ fontSize: 12, color: "#888", marginBottom: 4, marginTop: 8 }}>描述 / 備註 / Deadline</div>
              <textarea value={t.note || ""} onChange={e => setEditingTask({ ...t, note: e.target.value })} onBlur={() => handleUpdateTask(t.id, { note: t.note || null })} placeholder="輸入描述..." style={{ width: "100%", minHeight: 60, padding: "8px 10px", borderRadius: 8, border: "1px solid #e0e0e0", fontSize: 13, outline: "none", resize: "vertical", boxSizing: "border-box", fontFamily: "inherit" }} />
              <div style={{ fontSize: 12, color: "#888", marginTop: 16, marginBottom: 6 }}>子任務</div>
              {subtasks.map((st, i) => (
                <div key={st.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid #f5f5f5" }}>
                  <input type="checkbox" checked={st.status === "done"} onChange={() => handleToggleTaskDone(st)} style={{ width: 15, height: 15, cursor: "pointer" }} />
                  <span style={{ flex: 1, fontSize: 13, textDecoration: st.status === "done" ? "line-through" : "none", color: st.status === "done" ? "#999" : "#333" }}>{st.title}</span>
                  <button onClick={() => handleDeleteTask(st.id)} title="刪除" style={{ background: "none", border: "none", color: "#ccc", cursor: "pointer", fontSize: 14 }}>×</button>
                </div>
              ))}
              <form onSubmit={e => { e.preventDefault(); const v = e.target.elements.sub.value.trim(); if (v) { handleAddTask(t.employee_id, v, "none", t.id); e.target.reset(); } }} style={{ marginTop: 8 }}>
                <input name="sub" placeholder="+ 添加子任務" style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px dashed #d0d0d0", fontSize: 13, outline: "none", background: "#fafbff", boxSizing: "border-box" }} />
              </form>
              <div style={{ fontSize: 12, color: "#f59e0b", fontWeight: 700, marginTop: 16, marginBottom: 6 }}>💬 員工反饋</div>
              <textarea value={t.feedback || ""} onChange={e => setEditingTask({ ...t, feedback: e.target.value })} onBlur={() => handleUpdateTask(t.id, { feedback: t.feedback || null })} placeholder="例如：太忙，本週無法完成 / 需要 XXX 支援" style={{ width: "100%", minHeight: 50, padding: "8px 10px", borderRadius: 8, border: "1px solid #f4dca4", fontSize: 13, outline: "none", resize: "vertical", boxSizing: "border-box", background: "#fff9ec", fontFamily: "inherit" }} />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 20, paddingTop: 16, borderTop: "1px solid #f0f0f0" }}>
                <button onClick={() => handleDeleteTask(t.id)} style={{ background: "none", border: "none", color: "#e53935", fontSize: 13, cursor: "pointer" }}>🗑 刪除任務</button>
                <button onClick={() => setEditingTask(null)} style={{ background: "#6382ff", color: "#fff", border: "none", borderRadius: 10, padding: "9px 20px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>完成</button>
              </div>
            </div>
          </div>
        );
      })()}

      {showAddCustomer && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
          <div style={{ background: "#fff", borderRadius: 20, padding: 32, width: 580, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
              <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>新增客戶</h2>
              <button onClick={() => setShowAddCustomer(false)} style={{ background: "#f5f5f5", border: "none", borderRadius: 8, padding: "6px 10px", cursor: "pointer" }}><Icon name="x" size={16} /></button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
              <Input label="中文名 / Name *" value={newCustomer.name} onChange={v => setNewCustomer({...newCustomer, name: v})} placeholder="客戶名稱" />
              <Input label="Email" value={newCustomer.email} onChange={v => setNewCustomer({...newCustomer, email: v})} placeholder="email@example.com" />
              <Input label="香港電話" value={newCustomer.phone} onChange={v => setNewCustomer({...newCustomer, phone: v})} placeholder="+852" />
              <Input label="內地電話" value={newCustomer.phone_mainland} onChange={v => setNewCustomer({...newCustomer, phone_mainland: v})} placeholder="+86" />
              <Select label="汽車品牌 Car Brand" value={newCustomer.car_make} onChange={v => setNewCustomer({...newCustomer, car_make: v})} options={CAR_BRANDS} />
              <Input label="型號 Car Model" value={newCustomer.car_model} onChange={v => setNewCustomer({...newCustomer, car_model: v})} placeholder="e.g. Model 3, Han EV" />
              <Select label="客戶狀態" value={newCustomer.type} onChange={v => setNewCustomer({...newCustomer, type: v})} options={["Lead","Regular","VIP"]} />
              <Select label="客戶來源" value={newCustomer.referral} onChange={v => setNewCustomer({...newCustomer, referral: v})} options={REFERRAL_SOURCES} />
            </div>
            <Input label="地址" value={newCustomer.address} onChange={v => setNewCustomer({...newCustomer, address: v})} placeholder="完整地址" />
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 13, fontWeight: 700, color: "#555", display: "block", marginBottom: 8 }}>有興趣產品 Interested Products</label>
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
            <Input label="備註" value={newCustomer.notes} onChange={v => setNewCustomer({...newCustomer, notes: v})} placeholder="其他備註..." />
            <button onClick={handleSaveCustomer} disabled={!newCustomer.name || saving} style={{ width: "100%", padding: 14, background: newCustomer.name ? "#6382ff" : "#e0e0e0", color: "#fff", border: "none", borderRadius: 12, fontSize: 16, fontWeight: 800, cursor: newCustomer.name ? "pointer" : "not-allowed" }}>
              {saving ? "儲存中..." : "儲存客戶"}
            </button>
          </div>
        </div>
      )}

      {/* NEW INVOICE MODAL */}
      {showNewInvoice && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
          <div style={{ background: "#fff", borderRadius: 20, padding: 32, width: 560, maxHeight: "88vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
            {invoiceGenerated ? (
              <div style={{ textAlign: "center", padding: "40px 20px" }}>
                <div style={{ width: 72, height: 72, borderRadius: "50%", background: "#e8f5e9", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px", color: "#22c55e" }}><Icon name="check" size={36} /></div>
                <div style={{ fontSize: 22, fontWeight: 800 }}>發票已生成！</div>
                <div style={{ color: "#888", marginTop: 8, fontSize: 14 }}>PDF 已列印並儲存到資料庫</div>
              </div>
            ) : (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
                  <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>新建發票</h2>
                  <button onClick={closeNewInvoice} style={{ background: "#f5f5f5", border: "none", borderRadius: 8, padding: "6px 10px", cursor: "pointer" }}><Icon name="x" size={16} /></button>
                </div>
                <div style={{ marginBottom: 14 }}>
                  <label style={{ fontSize: 13, fontWeight: 700, color: "#555", display: "block", marginBottom: 5 }}>客戶</label>
                  <div style={{ position: "relative" }}>
                    <input
                      value={customerQuery}
                      onChange={e => {
                        setCustomerQuery(e.target.value);
                        if (newInvoice.customerId) setNewInvoice({...newInvoice, customerId: "", fieldOverrides: {}});
                        setCustomerDropdownOpen(true);
                      }}
                      onFocus={() => setCustomerDropdownOpen(true)}
                      onBlur={() => setTimeout(() => setCustomerDropdownOpen(false), 150)}
                      placeholder="輸入客戶姓名 / 電話 / 郵箱 / 車型搜索..."
                      style={{ width: "100%", padding: "10px 14px", paddingRight: newInvoice.customerId ? 38 : 14, borderRadius: 10, border: newInvoice.customerId ? "1px solid #6382ff" : "1px solid #e0e0e0", fontSize: 14, outline: "none", background: "#fff", boxSizing: "border-box" }}
                    />
                    {newInvoice.customerId && (
                      <button
                        onClick={() => { setNewInvoice({...newInvoice, customerId: "", fieldOverrides: {}}); setCustomerQuery(""); }}
                        style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "#f0f0f0", border: "none", borderRadius: "50%", width: 22, height: 22, cursor: "pointer", fontSize: 12, color: "#666", lineHeight: 1, padding: 0, display: "flex", alignItems: "center", justifyContent: "center" }}
                      >×</button>
                    )}
                    {customerDropdownOpen && (() => {
                      const q = customerQuery.toLowerCase().trim();
                      // 改用 virtualCustomers 去重，合并组只展示一次
                      const matched = customerGroups.virtualCustomers.filter(v => {
                        if ((!v.allNames || v.allNames.length === 0) && (!v.allPhones || v.allPhones.length === 0) && (!v.allEmails || v.allEmails.length === 0)) return false;
                        if (!q) return true;
                        const hit = (arr) => (arr || []).some(x => String(x).toLowerCase().includes(q));
                        return hit(v.allNames) || hit(v.allPhones) || hit(v.allEmails)
                          || splitMulti(v.car_make).some(x => x.toLowerCase().includes(q))
                          || splitMulti(v.car_model).some(x => x.toLowerCase().includes(q));
                      });
                      const top = matched.slice(0, 20);
                      return (
                        <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, maxHeight: 260, overflowY: "auto", background: "#fff", border: "1px solid #e0e0e0", borderRadius: 10, boxShadow: "0 4px 16px rgba(0,0,0,0.08)", zIndex: 100 }}>
                          {top.length === 0 ? (
                            <div style={{ padding: "12px 14px", fontSize: 13, color: "#999" }}>沒有符合的客戶，檢查拼寫或去「客戶」頁新增</div>
                          ) : (
                            <>
                              {top.map(v => {
                                const merged = v.groupCids && v.groupCids.length > 1;
                                const preview = [v.phone, v.email, splitMulti(v.car_make)[0], splitMulti(v.car_model)[0]].filter(Boolean).join(" · ");
                                return (
                                  <div
                                    key={v.id}
                                    onMouseDown={() => {
                                      // 选中合并组：customerId 存 root（= v.id），fieldOverrides 默认选第一值
                                      const overrides = {};
                                      for (const def of PRINT_FIELD_DEFS) {
                                        const arrVals = def.arr && v[def.arr] ? v[def.arr] : [];
                                        const singleVal = v[def.key];
                                        const sources = arrVals.length > 0 ? arrVals : (singleVal ? [singleVal] : []);
                                        const vals = [...new Set(sources.flatMap(s => splitMulti(s)))];
                                        if (vals.length > 0) overrides[def.key] = vals[0];
                                      }
                                      setNewInvoice({ ...newInvoice, customerId: v.id, fieldOverrides: overrides });
                                      setCustomerQuery([v.name, v.phone].filter(Boolean).join(" · "));
                                      setCustomerDropdownOpen(false);
                                    }}
                                    style={{ padding: "8px 14px", cursor: "pointer", borderBottom: "1px solid #f5f5f5" }}
                                    onMouseEnter={e => e.currentTarget.style.background = "#f8f9ff"}
                                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                                  >
                                    <div style={{ fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                                      {v.name || "(未命名客戶)"}
                                      {merged && <span style={{ fontSize: 10, color: "#6382ff", background: "#eef2ff", borderRadius: 20, padding: "1px 8px", fontWeight: 700 }}>已合併 {v.groupCids.length}</span>}
                                    </div>
                                    <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>{preview || "—"}</div>
                                  </div>
                                );
                              })}
                              {matched.length > 20 && (
                                <div style={{ padding: "8px 14px", fontSize: 11, color: "#999", background: "#fafafa", textAlign: "center" }}>
                                  還有 {matched.length - 20} 位客戶，繼續輸入縮小範圍
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                </div>
                {newInvoice.customerId && (() => {
                  const gid = customerGroups.idToGroup.get(newInvoice.customerId);
                  const virtual = gid ? customerGroups.virtualCustomers.find(v => v.id === gid) : null;
                  if (!virtual) return null;
                  const upgradeable = (virtual.groupCids || []).filter(id => id !== virtual.id).length;
                  if (upgradeable === 0) return null;
                  return (
                    <div style={{ marginBottom: 14, padding: "12px 14px", background: "#eef4ff", borderRadius: 10, border: "1px solid #c7d7ff", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                      <div style={{ fontSize: 13, color: "#2b4eb5", lineHeight: 1.4 }}>
                        <div style={{ fontWeight: 700, marginBottom: 2 }}>偵測到 {upgradeable} 條疑似重複客戶</div>
                        <div style={{ fontSize: 11, color: "#5b75b8" }}>虛擬合併中（資料命中 3+ 字段），可一鍵物理合併到主記錄</div>
                      </div>
                      <button
                        onClick={() => handleUpgradePhysical(virtual)}
                        style={{ background: "#6382ff", color: "#fff", border: "none", borderRadius: 8, padding: "8px 14px", fontWeight: 700, cursor: "pointer", fontSize: 12, whiteSpace: "nowrap" }}
                      >合併並繼續</button>
                    </div>
                  );
                })()}
                {newInvoice.customerId && (() => {
                  const gid = customerGroups.idToGroup.get(newInvoice.customerId);
                  const virtual = gid ? customerGroups.virtualCustomers.find(v => v.id === gid) : null;
                  if (!virtual) return null;
                  const multi = {};
                  for (const def of PRINT_FIELD_DEFS) {
                    const arrVals = def.arr && virtual[def.arr] ? virtual[def.arr] : [];
                    const singleVal = virtual[def.key];
                    const sources = arrVals.length > 0 ? arrVals : (singleVal ? [singleVal] : []);
                    const vals = [...new Set(sources.flatMap(s => splitMulti(s)))];
                    if (vals.length > 1) multi[def.key] = vals;
                  }
                  if (Object.keys(multi).length === 0) return null;
                  const labels = Object.fromEntries(PRINT_FIELD_DEFS.map(d => [d.key, d.label]));
                  return (
                    <div style={{ marginBottom: 14, padding: "14px 16px", background: "#fff9ec", borderRadius: 12, border: "1px solid #f4dca4" }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#8a6900", marginBottom: 10 }}>此客戶有多個資料，請選擇本次發票使用的</div>
                      {Object.keys(multi).map(field => (
                        <div key={field} style={{ marginBottom: 10 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: "#666", marginBottom: 6 }}>{labels[field] || field}</div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                            {multi[field].map((v, idx) => {
                              const checked = (newInvoice.fieldOverrides || {})[field] === v;
                              return (
                                <label key={idx} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "7px 10px", border: "1px solid " + (checked ? "#6382ff" : "#e8dfb6"), background: checked ? "#f0f4ff" : "#fff", borderRadius: 8, cursor: "pointer" }}>
                                  <input type="radio" name={"inv-fc-"+field} checked={checked} onChange={() => setNewInvoice(prev => ({ ...prev, fieldOverrides: { ...(prev.fieldOverrides || {}), [field]: v } }))} style={{ marginTop: 2 }} />
                                  <span style={{ fontSize: 13, color: "#111", whiteSpace: "pre-wrap", lineHeight: 1.4 }}>{v}</span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
                <div style={{ marginBottom: 14 }}>
                  <label style={{ fontSize: 13, fontWeight: 700, color: "#555", display: "block", marginBottom: 8 }}>商品項目</label>
                  {newInvoice.items.map((item, idx) => (
                    <div key={item.id} style={{ display: "grid", gridTemplateColumns: "1fr 56px 82px 72px auto", gap: 6, marginBottom: 8, alignItems: "start" }}>
                      <div style={{ position: "relative" }}>
                        <input
                          value={item.name}
                          onChange={e => { const items = [...newInvoice.items]; items[idx] = {...item, name: e.target.value}; setNewInvoice({...newInvoice, items}); }}
                          onFocus={() => setProductPickerOpenId(item.id)}
                          onBlur={() => setTimeout(() => setProductPickerOpenId(cur => cur === item.id ? null : cur), 150)}
                          placeholder="產品 / 服務（輸入關鍵字）"
                          style={{ padding: "9px 12px", borderRadius: 10, border: "1px solid #e0e0e0", fontSize: 14, outline: "none", width: "100%", boxSizing: "border-box" }}
                        />
                        {productPickerOpenId === item.id && (() => {
                          const q = (item.name || "").toLowerCase().trim();
                          const parentIds = new Set(products.filter(x => x.parent_product_id).map(x => x.parent_product_id));
                          const matched = products.filter(p => {
                            if (!p.name) return false;
                            if (p.category === '_archived') return false;
                            if (parentIds.has(p.id)) return false;
                            if (!q) return true;
                            return p.name.toLowerCase().includes(q) || (p.code || "").toLowerCase().includes(q) || (p.category || "").toLowerCase().includes(q);
                          });
                          const top = matched.slice(0, 10);
                          if (top.length === 0) return null;
                          return (
                            <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, width: 360, maxWidth: "calc(100vw - 80px)", maxHeight: 240, overflowY: "auto", background: "#fff", border: "1px solid #e0e0e0", borderRadius: 10, boxShadow: "0 4px 16px rgba(0,0,0,0.08)", zIndex: 100 }}>
                              {top.map(p => (
                                <div
                                  key={p.id}
                                  onMouseDown={() => {
                                    const items = [...newInvoice.items];
                                    items[idx] = {...item, name: p.name, price: Number(p.price) || item.price};
                                    setNewInvoice({...newInvoice, items});
                                    setProductPickerOpenId(null);
                                  }}
                                  style={{ padding: "8px 12px", cursor: "pointer", borderBottom: "1px solid #f5f5f5" }}
                                  onMouseEnter={e => e.currentTarget.style.background = "#f8f9ff"}
                                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                                >
                                  <div style={{ fontSize: 13, fontWeight: 600 }}>{p.name}</div>
                                  <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>
                                    HK${p.price ?? "—"}{p.category ? ` · ${p.category}` : ""}{p.stock != null ? ` · 庫存 ${p.stock}` : ""}
                                  </div>
                                </div>
                              ))}
                              {matched.length > 10 && (
                                <div style={{ padding: "6px 12px", fontSize: 10, color: "#999", background: "#fafafa", textAlign: "center" }}>
                                  還有 {matched.length - 10} 個產品，繼續輸入縮小範圍
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                      <input type="number" min="1" value={item.qty} onChange={e => { const items = [...newInvoice.items]; items[idx].qty = parseInt(e.target.value) || 1; setNewInvoice({...newInvoice, items}); }} style={{ padding: "9px 12px", borderRadius: 10, border: "1px solid #e0e0e0", fontSize: 14, outline: "none", textAlign: "center" }} />
                      <input type="number" value={item.price} onChange={e => { const items = [...newInvoice.items]; items[idx].price = parseFloat(e.target.value) || 0; setNewInvoice({...newInvoice, items}); }} placeholder="價格" style={{ padding: "9px 12px", borderRadius: 10, border: "1px solid #e0e0e0", fontSize: 14, outline: "none" }} />
                      <select value={item.warehouse_id || ''} onChange={e => { const items = [...newInvoice.items]; items[idx] = {...item, warehouse_id: e.target.value || null}; setNewInvoice({...newInvoice, items}); }} title="扣庫存的倉庫（不顯示在發票/收據上）" style={{ padding: "9px 6px", borderRadius: 10, border: "1px solid #e0e0e0", fontSize: 13, outline: "none", background: "#fff" }}>
                        {warehouses.map(w => <option key={w.id} value={w.id}>{w.name.replace("分部", "")}</option>)}
                      </select>
                      <button onClick={() => { const items = newInvoice.items.filter(i => i.id !== item.id); setNewInvoice({...newInvoice, items: items.length ? items : [mkItem(warehouses[0]?.id)]}); }} style={{ background: "#fce4ec", border: "none", borderRadius: 8, padding: "9px 10px", cursor: "pointer", color: "#e53935" }}><Icon name="x" size={13} /></button>
                    </div>
                  ))}
                  <button onClick={() => setNewInvoice({...newInvoice, items: [...newInvoice.items, mkItem(warehouses[0]?.id)]})} style={{ fontSize: 13, color: "#6382ff", background: "none", border: "1px dashed #6382ff", borderRadius: 8, padding: "8px 16px", cursor: "pointer", width: "100%" }}>+ 新增項目</button>
                </div>
                <div style={{ marginBottom: 14, padding: "14px 16px", background: "#fafbff", borderRadius: 12, border: "1px solid #eef0fa" }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#555", marginBottom: 10 }}>額外費用（可選）</div>
                  {[
                    { key: "deposit", label: "押金", sign: "+", color: "#6382ff" },
                    { key: "discount", label: "優惠", sign: "−", color: "#d14343" },
                    { key: "surcharge", label: "手續費", sign: "+", color: "#f59e0b" },
                  ].map(({ key, label, sign, color }) => {
                    const v = newInvoice[key] || { enabled: false, amount: 0 };
                    return (
                      <div key={key} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                        <input type="checkbox" id={`extra-${key}`} checked={v.enabled} onChange={e => setNewInvoice({ ...newInvoice, [key]: { ...v, enabled: e.target.checked } })} style={{ width: 16, height: 16, cursor: "pointer" }} />
                        <label htmlFor={`extra-${key}`} style={{ fontSize: 14, cursor: "pointer", minWidth: 70, fontWeight: 600 }}>
                          <span style={{ color, marginRight: 4 }}>{sign}</span>{label}
                        </label>
                        {v.enabled && (
                          <input type="number" min="0" value={v.amount || ""} onChange={e => setNewInvoice({ ...newInvoice, [key]: { ...v, amount: parseFloat(e.target.value) || 0 } })} placeholder="金額 HKD" style={{ flex: 1, padding: "7px 12px", borderRadius: 8, border: "1px solid #e0e0e0", fontSize: 14, outline: "none" }} />
                        )}
                      </div>
                    );
                  })}
                </div>
                <div style={{ marginBottom: 14 }}>
                  <label style={{ fontSize: 13, fontWeight: 700, color: "#555", display: "block", marginBottom: 5 }}>備註</label>
                  <input value={newInvoice.notes} onChange={e => setNewInvoice({...newInvoice, notes: e.target.value})} placeholder="例如 Shopify 訂單 #1055、WhatsApp 訂單..." style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid #e0e0e0", fontSize: 14, outline: "none", boxSizing: "border-box" }} />
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", background: "#f0f4ff", borderRadius: 12, marginBottom: 20 }}>
                  <input type="checkbox" id="warranty" checked={newInvoice.warranty} onChange={e => setNewInvoice({...newInvoice, warranty: e.target.checked})} style={{ width: 16, height: 16, cursor: "pointer" }} />
                  <label htmlFor="warranty" style={{ fontSize: 14, cursor: "pointer", fontWeight: 600 }}>客戶需要延長保修（+1 年）</label>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 20px", background: "#1a1a2e", borderRadius: 12, marginBottom: 16 }}>
                  <span style={{ color: "#aaa", fontSize: 14 }}>合計</span>
                  <span style={{ color: "#fff", fontSize: 24, fontWeight: 800 }}>HKD${invoiceTotal.toLocaleString()}</span>
                </div>
                <button onClick={handleGenerateInvoice} disabled={invoiceTotal === 0 || !newInvoice.customerId || saving} style={{ width: "100%", padding: 14, background: (invoiceTotal > 0 && newInvoice.customerId) ? "#6382ff" : "#e0e0e0", color: "#fff", border: "none", borderRadius: 12, fontSize: 16, fontWeight: 800, cursor: (invoiceTotal > 0 && newInvoice.customerId) ? "pointer" : "not-allowed" }}>
                  {saving ? "生成中..." : !newInvoice.customerId ? "請先選擇客戶" : "生成發票並列印 PDF"}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* EDIT PRODUCT STOCK MODAL (分倉) */}
      {editingProduct && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
          <div style={{ background: "#fff", borderRadius: 20, padding: 32, width: 440, boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
              <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>修改庫存</h2>
              <button onClick={() => setEditingProduct(null)} style={{ background: "#f5f5f5", border: "none", borderRadius: 8, padding: "6px 10px", cursor: "pointer" }}><Icon name="x" size={16} /></button>
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>{editingProduct.name}</div>
            <div style={{ fontFamily: "monospace", fontSize: 11, color: "#aaa", marginBottom: 20 }}>{editingProduct.internal_code}</div>
            {warehouses.map(w => (
              <div key={w.id} style={{ marginBottom: 14, display: "flex", alignItems: "center", gap: 12 }}>
                <label style={{ fontSize: 13, fontWeight: 700, color: "#555", minWidth: 80 }}>{w.name}</label>
                <input type="number" min="0" value={editStocks[w.id] ?? 0}
                  onChange={e => setEditStocks(s => ({ ...s, [w.id]: parseInt(e.target.value) || 0 }))}
                  style={{ flex: 1, padding: "10px 14px", borderRadius: 10, border: "1px solid #e0e0e0", fontSize: 16, fontWeight: 700, outline: "none", textAlign: "center" }} />
              </div>
            ))}
            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <button onClick={() => setEditingProduct(null)} style={{ flex: 1, padding: 12, background: "#f5f5f5", color: "#666", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: "pointer" }}>取消</button>
              <button onClick={async () => {
                const upserts = [];
                const movements = [];
                for (const w of warehouses) {
                  const newQty = editStocks[w.id] ?? 0;
                  const existing = stocks.find(s => s.product_id === editingProduct.id && s.warehouse_id === w.id);
                  const oldQty = existing ? existing.qty : 0;
                  if (newQty === oldQty) continue;
                  upserts.push({ product_id: editingProduct.id, warehouse_id: w.id, qty: newQty, updated_at: new Date().toISOString() });
                  movements.push({ product_id: editingProduct.id, warehouse_id: w.id, delta: newQty - oldQty, type: "adjust", reason: "手動調整" });
                }
                if (upserts.length === 0) { setEditingProduct(null); return; }
                const { error: upErr } = await supabase.from("inventory_stock").upsert(upserts, { onConflict: "product_id,warehouse_id" });
                if (upErr) { alert(`庫存儲存失敗：${upErr.message}`); return; }
                if (movements.length > 0) {
                  await supabase.from("inventory_movements").insert(movements);
                }
                // 本地同步 stocks
                setStocks(prev => {
                  const map = new Map(prev.map(s => [`${s.product_id}_${s.warehouse_id}`, s]));
                  for (const u of upserts) {
                    const k = `${u.product_id}_${u.warehouse_id}`;
                    const old = map.get(k);
                    map.set(k, { ...(old || { id: crypto.randomUUID() }), ...u });
                  }
                  return [...map.values()];
                });
                setEditingProduct(null);
              }} style={{ flex: 1, padding: 12, background: "#6382ff", color: "#fff", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: "pointer" }}>儲存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
