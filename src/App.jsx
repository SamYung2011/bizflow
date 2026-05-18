import React, { useState, useEffect, useMemo, Suspense, lazy } from "react";

// 報銷模組：lazy load 防內存爆。切到「報銷」tab 才下載這 chunk
const ExpenseView = lazy(() => import("./views/Expense.jsx"));
import { useQueryClient } from "@tanstack/react-query";
import { supabase, fetchAllTable } from "./lib/supabaseClient.js";
import { isNonWarrantyItem, itemWarrantyMonths } from "./lib/warranty.js";
import { useAppContext } from "./context/AppContext.jsx";
import { Icon } from "./components/Icon.jsx";
import { Input, Select } from "./components/Inputs.jsx";
import { suggestEmail } from "./lib/emailSuggest.js";
import { CAR_BRANDS, PRODUCTS_LIST, REFERRAL_SOURCES } from "./lib/constants.js";
import { computeCommissionFor } from "./lib/commission.js";
import { ProductEditModal, ProductNewModal, ProductsListView, ProductsDetailView, emptyNewProduct } from "./views/Products.jsx";
import { AddCustomerModal, EditCustomerModal, MergeHistoryModal, RollbackModal, MergeCandidatesModal, CustomersListView, CustomersDetailView } from "./views/Customers.jsx";
import InvoicesView from "./views/Invoices.jsx";
import { INVOICE_SHELL_HEAD, INVOICE_PAGE, INVOICE_SHELL_TAIL } from "./invoiceTemplate.js";
import { RECEIPT_FRAGMENT } from "./receiptTemplate.js";
import { useT } from "./i18n.jsx";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";

// 個人偏好：是否啟用 markdown 渲染輸出（部分使用者偏好富文本格式）
// 後續可改為 employees / users 表 prefs.markdown_enabled 字段
const MARKDOWN_LOG_AUTHORS = new Set(["1267481a-503f-4154-829e-bc97788b4567"]);
const MARKDOWN_COMMENT_AUTHORS = new Set(["2f88a573-c4db-4b93-aadc-2a56106c5f9c"]);
// 小型 markdown 渲染組件（限縮 className 範圍 + 樣式），給更新日誌用
function MarkdownText({ text, fontSize = 14 }) {
  if (!text) return null;
  return (
    <div className="md" style={{ fontSize, lineHeight: 1.6 }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={{
          a: (props) => <a {...props} target="_blank" rel="noopener noreferrer" style={{ color: "#6382ff" }} />,
          code: ({ className, children, ...props }) => {
            // react-markdown v10：block code 帶 className="language-xxx"，inline code 沒 className
            const isBlock = /language-/.test(className || "");
            return isBlock
              ? <code {...props} className={className} style={{ fontFamily: "Menlo,Monaco,monospace", fontSize: "0.9em" }}>{children}</code>
              : <code {...props} style={{ background: "#f0f0f0", padding: "1px 5px", borderRadius: 4, fontSize: "0.9em", fontFamily: "Menlo,Monaco,monospace" }}>{children}</code>;
          },
          pre: (props) => <pre {...props} style={{ background: "#f5f5f5", padding: 10, borderRadius: 6, overflow: "auto", margin: "8px 0" }} />,
          blockquote: (props) => <blockquote {...props} style={{ borderLeft: "3px solid #c6d3ff", margin: "8px 0", padding: "2px 10px", color: "#666" }} />,
          ul: (props) => <ul {...props} style={{ paddingLeft: 22, margin: "6px 0" }} />,
          ol: (props) => <ol {...props} style={{ paddingLeft: 22, margin: "6px 0" }} />,
          li: (props) => <li {...props} style={{ marginBottom: 2 }} />,
          h1: (props) => <h1 {...props} style={{ fontSize: "1.4em", margin: "8px 0", fontWeight: 800 }} />,
          h2: (props) => <h2 {...props} style={{ fontSize: "1.25em", margin: "8px 0", fontWeight: 800 }} />,
          h3: (props) => <h3 {...props} style={{ fontSize: "1.1em", margin: "6px 0", fontWeight: 700 }} />,
          table: (props) => <table {...props} style={{ borderCollapse: "collapse", margin: "8px 0" }} />,
          th: (props) => <th {...props} style={{ border: "1px solid #e0e0e0", padding: "4px 8px", background: "#fafbff", fontWeight: 700 }} />,
          td: (props) => <td {...props} style={{ border: "1px solid #e0e0e0", padding: "4px 8px" }} />,
        }}
      >{text}</ReactMarkdown>
    </div>
  );
}

// Chrome 雲端版扩展最新版本（發版時跟 chrome-extension-cloud/manifest.json 的 version 同步改）
const LATEST_EXT_VERSION_FALLBACK = "1.3.3";

const LOGO_B64 = "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";

// CAR_BRANDS / PRODUCTS_LIST / REFERRAL_SOURCES 已抽到 src/lib/constants.js

// ── ICONS ──────────────────────────────────────────────────────────────────────
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

// suggestEmail 已抽到 src/lib/emailSuggest.js
// Input / Select 已抽到 src/components/Inputs.jsx

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
    // 純數字 → pad 到 5 位
    if (/^\d+$/.test(invNumShort)) invNumShort = invNumShort.padStart(5, "0");
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
  // 設置 document.title 讓「另存為 PDF」默認檔名為發票編號（DC1525.pdf）
  try { w.document.title = "DC" + invNumShort; } catch {}
  setTimeout(() => w.print(), 500);
}

// ── MAIN APP ───────────────────────────────────────────────────────────────────
export default function App() {
  const { t, lang, setLang } = useT();
  // Supabase Auth + 數據層整套搬到 AppContext。session/authLoading/userId/
  // currentEmployee/isBfAdmin/isWaAdmin/canShip/qTaskPending 從 useAppContext 拿回。
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPw, setLoginPw] = useState("");
  const [loginError, setLoginError] = useState("");
  // 反饋附件待上傳文件（task edit modal 內，editingTask 切換時清空）
  const [pendingAttachments, setPendingAttachments] = useState([]);
  // 添加任務時待上傳的附件（員工管理頁右側「+ 添加任務」表單）
  const [newTaskAttachments, setNewTaskAttachments] = useState([]);
  // 任務未讀反饋追蹤的 dummy tick（更新 localStorage 後遞增讓任務卡重渲染）
  const [taskSeenTick, setTaskSeenTick] = useState(0);
  // 員工資料編輯模式（id = 當前正在編輯的員工 id；null = 全部 view 模式）
  const [editingEmpId, setEditingEmpId] = useState(null);
  // 反饋回復模式（id = 正在回復的反饋 id；null = 普通新發反饋）
  const [replyingToFb, setReplyingToFb] = useState(null);
  // 個人資料 modal
  const [showProfile, setShowProfile] = useState(false);
  const [profileDraft, setProfileDraft] = useState({ name: "", role: "", phone: "", email: "", note: "" });
  // 強制改密 modal（首次登入用初始密碼進來時）
  const [forceChangePw1, setForceChangePw1] = useState("");
  const [forceChangePw2, setForceChangePw2] = useState("");
  const [forceChangePwErr, setForceChangePwErr] = useState("");
  const [forceChangePwLoading, setForceChangePwLoading] = useState(false);
  const [loginBusy, setLoginBusy] = useState(false);

  // 數據層 + auth/admin + tab + loading 整套都從 AppContext 拿
  const {
    session, setSession,
    authLoading, setAuthLoading,
    userId, currentEmployee, isBfAdmin, isWaAdmin, canShip,
    tab, setTab,
    loading, setLoading,
    loadError, setLoadError,
    products, setProducts,
    warehouses, setWarehouses,
    stocks, setStocks,
    suppliers, setSuppliers,
    customers, setCustomers,
    lineItemAliases, setLineItemAliases,
    invoices, setInvoices,
    inventory, setInventory,
    employees, setEmployees,
    tasks, setTasks,
    taskAssignees, setTaskAssignees,
    feedbacks, setFeedbacks,
    updateLogs, setUpdateLogs,
    logComments, setLogComments,
    waSettings, setWaSettings,
    waWhitelist, setWaWhitelist,
    waMessages, setWaMessages,
    waUnresolved, setWaUnresolved,
    waReports, setWaReports,
    waLogs, setWaLogs,
    waClients, setWaClients,
    waHeartbeat, setWaHeartbeat,
    qProducts, qWarehouses, qStocks, qSuppliers,
    qCustomers, qLineItemAliases,
    qInvoices, qInventory,
    qEmployees, qTasks, qTaskAssignees,
    qFeedbacks, qUpdateLogs, qLogComments,
    qWaSettings, qWaWhitelist, qWaMessages, qWaPending, qWaUnresolved,
    qCompanies, qWaReports, qWaHeartbeat, qWaLogs, qWaClients,
    qTaskPending,
  } = useAppContext();

  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [showAddEmployee, setShowAddEmployee] = useState(false);
  const [newEmployee, setNewEmployee] = useState({ name: "", role: "", phone: "", email: "", note: "" });
  const [editingTask, setEditingTask] = useState(null); // 任務詳情 modal 當前任務
  const [newTaskDraft, setNewTaskDraft] = useState({ title: "", priority: "low", note: "", assigneeIds: null, needsApproval: false });
  const [newSubTaskDraft, setNewSubTaskDraft] = useState({ assigneeIds: null }); // 子任務分配，null = 繼承父；needsApproval 永遠跟父走
  const [subTaskAssigneeInput, setSubTaskAssigneeInput] = useState("");
  const [subTaskAssigneeOpen, setSubTaskAssigneeOpen] = useState(false);
  const [taskNotices, setTaskNotices] = useState([]); // 堆疊通知：[{ type, count, ids, ... }]
  const [dismissedNoticeTypes, setDismissedNoticeTypes] = useState(new Set()); // session 內 dismiss 過的 type 不再出現
  const [pendingMentions, setPendingMentions] = useState([]); // 反饋輸入時 @ 的 auth.users.id 數組
  const [fbInputValue, setFbInputValue] = useState(""); // 反饋輸入框文本（受控，用於 @ mention 識別）
  const [mentionPopup, setMentionPopup] = useState({ open: false, query: "", atIdx: -1 }); // @ 自動補全下拉狀態
  const [newTaskAssigneeInput, setNewTaskAssigneeInput] = useState(""); // 創建任務的分配輸入框
  const [newTaskAssigneeOpen, setNewTaskAssigneeOpen] = useState(false);
  const [editTaskAssigneeInput, setEditTaskAssigneeInput] = useState(""); // 編輯任務的分配輸入框
  const [editTaskAssigneeOpen, setEditTaskAssigneeOpen] = useState(false);
  const [showAddSupplier, setShowAddSupplier] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState(null);
  const [supplierSearch, setSupplierSearch] = useState("");
  const [supplierCategoryFilter, setSupplierCategoryFilter] = useState("all");
  const [newSupplier, setNewSupplier] = useState({ name: "", contact_url: "", contact_person: "", category: "", note: "" });
  // productsSubTab / editingAlias / aliasSaving / expandedAliasGroups 已搬到 ProductsListView 本地
  const [empSubTab, setEmpSubTab] = useState("tasks"); // "tasks" | "logs"
  const [empPageMode, setEmpPageMode] = useState("list"); // "list" | "overview"
  const [overviewExpanded, setOverviewExpanded] = useState(new Set()); // 總覽展開的員工 id
  const [newLogDraft, setNewLogDraft] = useState({ summary: "", detail: "" });
  const [editingLogId, setEditingLogId] = useState(null);
  const [editingLogDraft, setEditingLogDraft] = useState({ summary: "", detail: "" });
  const [expandedLogIds, setExpandedLogIds] = useState(() => new Set());
  const [newLogCommentDraft, setNewLogCommentDraft] = useState({}); // { [logId|"reply:logId:parentId"]: text }
  const [replyingToLogComment, setReplyingToLogComment] = useState(null); // { logId, parentId }
  const [editingLogComment, setEditingLogComment] = useState(null); // { id, body }
  const [logsVisibleCount, setLogsVisibleCount] = useState(20); // 時間軸懶加載：當前可見條數
  const [showInstallTutorial, setShowInstallTutorial] = useState(false);
  // 扩展更新 toast：純內存 state，× 關掉只在本次頁面 session 內生效。刷新頁面就重新彈（提醒及時感）
  const [extUpdateToastDismissedFor, setExtUpdateToastDismissedFor] = useState("");
  const [waSubTab, setWaSubTab] = useState("settings"); // settings | knowledge | prompt | whitelist | messages | unresolved | reports | logs
  const [waSelectedCustomer, setWaSelectedCustomer] = useState(null);
  const [waSecretUnlocked, setWaSecretUnlocked] = useState(false); // 輸過密碼後這次 session 內放開
  const [selectedProduct, setSelectedProduct] = useState(null);
  // productOrgDraft / expandedSkuGroups 已搬到 ProductsDetailView 本地
  const [search, setSearch] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [showAddCustomer, setShowAddCustomer] = useState(false);
  const [saving, setSaving] = useState(false);
  const [visibleWarranty, setVisibleWarranty] = useState(50);
  const [warrantySearch, setWarrantySearch] = useState("");
  const [warrantyBucket, setWarrantyBucket] = useState("all"); // all | expired | soon | near | far
  const [revenueRange, setRevenueRange] = useState("12m"); // thisMonth | lastMonth | 3m | 12m | year | all
  const [dashSearch, setDashSearch] = useState("");
  const [editingCustomer, setEditingCustomer] = useState(null); // 当前被编辑的真实 customer 对象（单条记录，不是 virtualCustomer）
  const [editCustCid, setEditCustCid] = useState(""); // 合并组内选中要编辑的 cid
  const [manualMergeOpen, setManualMergeOpen] = useState(false);
  const [manualMergeQuery, setManualMergeQuery] = useState("");
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
    if (affected.length === 0) { alert(t("請至少勾選一條要回退的記錄")); return; }
    if (rollbackTarget === "mergeTo" && !rollbackMergeTo) { alert(t("請選擇要合併到的客戶")); return; }
    if (rollbackTarget === "mergeTo" && affected.includes(rollbackMergeTo)) { alert(t("不能合併到自己")); return; }
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
      if (error) { setRollbackBusy(false); alert(t("回退失敗：") + error.message); return; }
    }
    if (patches.size > 0) {
      setCustomers(prev => prev.map(c => patches.has(c.id) ? { ...c, ...patches.get(c.id) } : c));
    }
    setRollbackBusy(false);
    setRollbackOpen(null);
    setMergeHistoryOpen(null);
  }
  async function handleUnmerge(childCid) {
    const ok = window.confirm(t("確定撤銷此合併？該記錄會變回獨立客戶，發票關聯不變。"));
    if (!ok) return;
    const { error } = await supabase.from("customers").update({ parent_id: null }).eq("id", childCid);
    if (error) { alert(t("撤銷失敗：") + error.message); return; }
    setCustomers(prev => prev.map(c => c.id === childCid ? { ...c, parent_id: null } : c));
  }
  async function handleUpgradePhysical(vc) {
    const primaryCid = vc?.id;
    if (!primaryCid) return;
    const siblings = (vc.groupCids || []).filter(id => id !== primaryCid);
    if (siblings.length === 0) return;
    const ok = window.confirm(
      `${t("確定把")} ${siblings.length} ${t("條疑似重複的記錄物理合併到")}「${vc.name || t('(無名)')}」?\n\n` +
      `${t("合併後這些記錄會掛在主記錄下，字段（電話/郵箱/地址等）歸主記錄管理；")}\n` +
      t("下次編輯時刪除字段才會真生效。可在合併記錄裡隨時點「撤銷合併」還原。")
    );
    if (!ok) return;
    const { error } = await supabase.from("customers").update({ parent_id: primaryCid }).in("id", siblings);
    if (error) { alert(t("升級物理合併失敗：") + error.message); return; }
    setCustomers(prev => prev.map(c => siblings.includes(c.id) ? { ...c, parent_id: primaryCid } : c));
    setMergeHistoryOpen(null);
  }
  const [mergeAllBusy, setMergeAllBusy] = useState(false);
  async function handleMergeAllPhysical(candidates) {
    const updates = candidates
      .map(vc => ({ keeper: vc.id, siblings: (vc.groupCids || []).filter(id => id !== vc.id) }))
      .filter(u => u.siblings.length > 0);
    const total = updates.reduce((s, u) => s + u.siblings.length, 0);
    if (total === 0) return;
    const ok = window.confirm(
      `${t("確定一鍵合併全部")} ${updates.length} ${t("組")}（${t("共")} ${total} ${t("條")}）？\n\n` +
      `${t("所有疑似重複的記錄會掛到主記錄下，字段歸主記錄管理。可隨時撤銷。")}`
    );
    if (!ok) return;
    setMergeAllBusy(true);
    const errors = [];
    const okUpdates = [];
    const BATCH = 10;
    for (let i = 0; i < updates.length; i += BATCH) {
      const batch = updates.slice(i, i + BATCH);
      const results = await Promise.all(batch.map(async u => {
        const { error } = await supabase.from("customers").update({ parent_id: u.keeper }).in("id", u.siblings);
        return { u, error };
      }));
      results.forEach(r => { if (r.error) errors.push(r.error.message); else okUpdates.push(r.u); });
    }
    setCustomers(prev => prev.map(c => {
      for (const u of okUpdates) if (u.siblings.includes(c.id)) return { ...c, parent_id: u.keeper };
      return c;
    }));
    setMergeAllBusy(false);
    setMergeCandidatesOpen(false);
    if (errors.length) alert(`${t("部分合併失敗")}：\n` + errors.slice(0, 5).join("\n"));
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
    if (error) { setEditCustSaving(false); alert(t("保存失敗：") + error.message); return; }
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
      if (e) { setEditCustSaving(false); alert(t("關聯記錄更新失敗：") + e.message); return; }
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
      if (e) { setEditCustSaving(false); alert(t("別名降級失敗：") + e.message); return; }
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
        if (e) { setEditCustSaving(false); alert(t("別名合併失敗：") + e.message); return; }
        usedSiblingIds.add(match.id);
        if (data) adoptedRows.push(data);
      } else {
        const { data, error: e } = await supabase.from("customers").insert({
          name: aliasName, parent_id: editCustCid, type: editCustForm.type || "Regular"
        }).select().single();
        if (e) { setEditCustSaving(false); alert(t("別名新增失敗：") + e.message); return; }
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
    { key: "name", label: t("姓名"), arr: "allNames" },
    { key: "phone", label: t("香港電話"), arr: "allPhones" },
    { key: "phone_mainland", label: t("內地電話"), arr: "allPhoneMainlands" },
    { key: "email", label: t("郵箱"), arr: "allEmails" },
    { key: "address", label: t("地址"), arr: "allAddresses" },
    { key: "car_make", label: t("車品牌"), arr: "allCarMakes" },
    { key: "car_model", label: t("車型"), arr: "allCarModels" },
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
      if (error) { alert(t("合併失敗（更新老客戶）：") + error.message); setMergeBusy(false); return; }
    }
    const newNotes = (inv.notes || "").replace(/\s*__PENDING_MERGE__:[\w-]+/g, "").trim();
    const { error: invErr } = await supabase.from("invoices").update({ customer_id: oldCustomer.id, notes: newNotes }).eq("id", inv.id);
    if (invErr) { alert(t("合併失敗（更新發票）：") + invErr.message); setMergeBusy(false); return; }
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

  const [markPaidCtx, setMarkPaidCtx] = useState(null); // { inv, defaultWh } —— 標記已付款彈窗
  const [stockToast, setStockToast] = useState(null); // { items: [name] } —— 右下角庫存不足 toast
  const [editingProduct, setEditingProduct] = useState(null);
  const [editStock, setEditStock] = useState(0);
  const [editStocks, setEditStocks] = useState({});
  const [editProductPrice, setEditProductPrice] = useState("");
  const [editProductWarranty, setEditProductWarranty] = useState("");

  // emptyNewProduct 已抽到 ./views/Products.jsx
  const [newProductOpen, setNewProductOpen] = useState(false);
  const [newProduct, setNewProduct] = useState(emptyNewProduct());
  const [newProductSaving, setNewProductSaving] = useState(false);

  const [newCustomer, setNewCustomer] = useState({
    name: "", email: "", phone: "", phone_mainland: "",
    car_make: "", car_model: "", address: "",
    interest_products: [], referral: "", type: "Lead", notes: ""
  });

  // 客戶頁過濾/排序：按需計算最近購買日期 + 搜索 + 時間範圍 + 排序
  // 客戶去重：
  //   規則 1（虛擬合併，union-find）：name/phone/email/address 4 字段命中 3+ 視為疑似同人
  //   規則 2（物理合併，DB parent_id）：除 name 外所有字段完全相等 + name 都非空 → UPDATE parent_id = keeper.id
  //     parent_id 非空的子記錄不作為獨立客戶顯示，名字作別名加入 keeper 的 allNames
  const customerGroups = useMemo(() => {
    const norm = s => (s || "").trim().toLowerCase();
    // fields：multi=多值（按 \n 分行）；fuzzy=允許每行 edit distance ≤ 1 命中
    const fields = [
      { key: "name",           multi: false, fuzzy: false },
      { key: "phone",          multi: true,  fuzzy: false },
      { key: "phone_mainland", multi: true,  fuzzy: false },
      { key: "email",          multi: true,  fuzzy: true  },
      { key: "address",        multi: true,  fuzzy: true  },
    ];
    // edit distance ≤ 1（容忍 1 個字的錯漏）
    const editDist1 = (a, b) => {
      if (a === b) return true;
      const la = a.length, lb = b.length;
      if (Math.abs(la - lb) > 1) return false;
      let i = 0, j = 0, edits = 0;
      while (i < la && j < lb) {
        if (a[i] === b[j]) { i++; j++; continue; }
        if (++edits > 1) return false;
        if (la === lb) { i++; j++; }
        else if (la > lb) i++;
        else j++;
      }
      if (i < la || j < lb) edits++;
      return edits <= 1;
    };
    const splitLinesLower = s => String(s || "").split(/\n+/).map(x => x.trim().toLowerCase()).filter(Boolean);
    const lineMatch = (a, b, fuzzy) => fuzzy ? editDist1(a, b) : a === b;
    const fieldMatch = (f, ca, cb) => {
      if (f.multi) {
        const A = splitLinesLower(ca[f.key]), B = splitLinesLower(cb[f.key]);
        if (A.length === 0 || B.length === 0) return false;
        for (const x of A) for (const y of B) if (lineMatch(x, y, f.fuzzy)) return true;
        return false;
      }
      const a = norm(ca[f.key]), b = norm(cb[f.key]);
      return !!a && a === b;
    };
    // 兜底去重：state 異常時可能有重複 id（fetchAllTable 已修，這裡再保險）
    const uniqueCustomers = Array.from(new Map(customers.map(c => [c.id, c])).values());
    const idToCustomer = new Map();
    uniqueCustomers.forEach(c => idToCustomer.set(c.id, c));
    const childrenByParent = new Map();
    uniqueCustomers.forEach(c => {
      if (c.parent_id) {
        if (!childrenByParent.has(c.parent_id)) childrenByParent.set(c.parent_id, []);
        childrenByParent.get(c.parent_id).push(c);
      }
    });
    const independents = uniqueCustomers.filter(c => !c.parent_id);
    // exact-match indexes：multi 字段每行一個 entry，single 字段整字段
    const indexes = fields.map(() => new Map());
    independents.forEach(c => {
      fields.forEach((f, i) => {
        const lines = f.multi ? splitLinesLower(c[f.key]) : [norm(c[f.key])].filter(Boolean);
        lines.forEach(line => {
          if (!indexes[i].has(line)) indexes[i].set(line, []);
          indexes[i].get(line).push(c.id);
        });
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
        const lines = f.multi ? splitLinesLower(c[f.key]) : [norm(c[f.key])].filter(Boolean);
        lines.forEach(line => {
          indexes[i].get(line)?.forEach(id => { if (id !== c.id) candidates.add(id); });
        });
      });
      candidates.forEach(id => {
        const other = idToCustomer.get(id);
        if (!other) return;
        const ex1 = Array.isArray(c.merge_exclude) ? c.merge_exclude : [];
        const ex2 = Array.isArray(other.merge_exclude) ? other.merge_exclude : [];
        if (ex1.includes(other.id) || ex2.includes(c.id)) return;
        let matches = 0;
        fields.forEach(f => { if (fieldMatch(f, c, other)) matches++; });
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
    uniqueCustomers.forEach(c => {
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

  // 每個 customer 的來源（按最早 invoice 推斷）→ shopify / framer / other
  // 發票頁過濾：按搜索關鍵字 (發票號 / 客戶名 / 備註)
  // 物流狀態的派生：沒填單號就是「待發貨」，否則用 shipping_status（保底）
  const deriveShippingStatus = (inv) => {
    if (inv.shipping_status) return inv.shipping_status;
    return inv.tracking_number ? '已發貨' : '待發貨';
  };
  // 物流追蹤啟用日期：之前的歷史發票太多（4500+ 張 NULL status），不納入「待發貨」統計/列表
  // 老單若需補追蹤，編輯時填單號照樣會走 trigger + Edge Function
  const SHIPPING_TRACKING_SINCE = '2026-05-05';
  const isShippingTrackable = (inv) => (inv?.date || '') >= SHIPPING_TRACKING_SINCE;

  const queryClient = useQueryClient();

  // task_assignees 按 task_id 分組（多處用，避免重複掃描）
  // 兜底用 qTaskAssignees.data：state 同步比 tasks 慢一幀時避免 race（剛發布完任務刷新被分配員工那邊瞬間看不到）
  const assigneesByTask = useMemo(() => {
    const src = (taskAssignees && taskAssignees.length > 0) ? taskAssignees : (qTaskAssignees.data || []);
    const m = new Map();
    for (const a of src) {
      const arr = m.get(a.task_id);
      if (arr) arr.push(a); else m.set(a.task_id, [a]);
    }
    return m;
  }, [taskAssignees, qTaskAssignees.data]);
  // 判斷 task 是否分配給 empId（fallback：assignees 表沒記錄則看 employee_id 兼容舊數據）
  const isTaskAssignedTo = (task, empId) => {
    const list = assigneesByTask.get(task.id);
    if (list && list.length > 0) return list.some(a => a.employee_id === empId);
    return task.employee_id === empId;
  };
  // 任務是否處於「等待發布人核驗」狀態：勾了 needs_approval + task 未終結 + 全員都已個人結算（done/abandoned）
  const isAwaitingApproval = (task) => {
    if (!task || !task.needs_approval) return false;
    if (task.status !== "open") return false;
    const list = assigneesByTask.get(task.id) || [];
    if (list.length === 0) return false;
    return list.every(a => a.completed_at != null || a.abandoned_at != null);
  };

  // 刪除權限：admin / 發布人 全權；assignee 僅當「父任務 + 獨占 + 不需核驗」可自刪；其他人不行
  const canDeleteTask = (task) => {
    if (!task) return false;
    if (isBfAdmin) return true;
    if (!currentEmployee) return false;
    if (task.creator_employee_id === currentEmployee.id) return true;
    if (task.parent_task_id) return false;
    if (task.needs_approval) return false;
    const list = assigneesByTask.get(task.id) || [];
    if (list.length !== 1) return false;
    return list[0].employee_id === currentEmployee.id;
  };

  // 某員工對某 task 的個人完成狀態（看自己 task_assignees.completed_at；舊數據 fallback task.status）
  const empIsDoneFor = (task, empId) => {
    const list = assigneesByTask.get(task.id);
    if (list && list.length > 0) {
      const row = list.find(a => a.employee_id === empId);
      return row ? row.completed_at != null : (task.status === "done");
    }
    return task.status === "done";
  };
  // 某員工對某 task 的個人放棄狀態（task_assignees.abandoned_at OR task 整體 abandoned 都算）
  const empIsAbandonedFor = (task, empId) => {
    const list = assigneesByTask.get(task.id);
    if (list && list.length > 0) {
      const row = list.find(a => a.employee_id === empId);
      if (row && row.abandoned_at != null) return true;
    }
    return task.status === "abandoned";
  };

  // 所有 query data → useState 的同步 effect 已全部遷至 AppContext（除 qTaskPending 暫留 App.jsx）
  // 任務提醒：tasks/assignees/feedbacks 加載完一次後計算所有類型 → 堆疊顯示
  useEffect(() => {
    if (!currentEmployee || !userId) return;
    const notices = [];
    // 1. 反饋 @ 我（持久 dismiss）
    if (!dismissedNoticeTypes.has('feedback')) {
      const seenFbKey = `bf_seen_fb_${userId}`;
      let seenFb = new Set();
      try { seenFb = new Set(JSON.parse(localStorage.getItem(seenFbKey) || '[]')); } catch {}
      const myMentions = feedbacks.filter(f => {
        const mentioned = Array.isArray(f.mentioned_user_ids) ? f.mentioned_user_ids : [];
        return mentioned.includes(userId) && !seenFb.has(f.id) && f.author_user_id !== userId;
      });
      if (myMentions.length > 0) {
        const byTask = new Map();
        for (const f of myMentions) {
          if (!byTask.has(f.task_id)) byTask.set(f.task_id, []);
          byTask.get(f.task_id).push(f);
        }
        const taskTitles = [];
        for (const [taskId, fbList] of byTask) {
          const tk = tasks.find(t => t.id === taskId);
          if (tk) taskTitles.push({ title: tk.title, count: fbList.length });
        }
        notices.push({ type: 'feedback', count: myMentions.length, ids: myMentions.map(f => f.id), tasks: taskTitles });
      }
    }
    // 2. 待核驗（我是發布人）
    if (!dismissedNoticeTypes.has('approval')) {
      const awaiting = tasks.filter(t => t.creator_employee_id === currentEmployee.id && isAwaitingApproval(t));
      if (awaiting.length > 0) notices.push({ type: 'approval', count: awaiting.length, ids: awaiting.map(t => t.id) });
    }
    // 3. 待處理任務（我是 assignee + 自己未結算）
    if (!dismissedNoticeTypes.has('new')) {
      const pending = tasks.filter(t =>
        !t.parent_task_id &&
        t.status === 'open' &&
        isTaskAssignedTo(t, currentEmployee.id) &&
        !empIsDoneFor(t, currentEmployee.id) &&
        !empIsAbandonedFor(t, currentEmployee.id)
      );
      if (pending.length > 0) notices.push({ type: 'new', count: pending.length, ids: pending.map(t => t.id) });
    }
    setTaskNotices(notices);
  }, [tasks, taskAssignees, feedbacks, currentEmployee?.id, userId, dismissedNoticeTypes]);
  // 切員工 / 切回更新日誌 tab 時重置懶加載計數
  useEffect(() => { setLogsVisibleCount(20); }, [selectedEmployee?.id, empSubTab]);

  // 進 task detail modal 時自動標記該 task 反饋為已讀（更新 localStorage + 觸發任務卡重渲染）
  useEffect(() => {
    if (editingTask?.id && userId) {
      localStorage.setItem(`bf_task_seen_${editingTask.id}_${userId}`, Date.now().toString());
      setTaskSeenTick(v => v + 1);
    }
    // 切換 task 時清空 pendingAttachments
    setPendingAttachments([]);
  }, [editingTask?.id, userId]);

  // 打開編輯產品彈窗時從 stocks/products 載入當前值
  useEffect(() => {
    if (!editingProduct) {
      setEditStocks({});
      setEditProductPrice("");
      setEditProductWarranty("");
      return;
    }
    const init = {};
    for (const w of warehouses) {
      const row = stocks.find(s => s.product_id === editingProduct.id && s.warehouse_id === w.id);
      init[w.id] = row ? row.qty : 0;
    }
    setEditStocks(init);
    setEditProductPrice(editingProduct.price != null ? String(editingProduct.price) : "");
    setEditProductWarranty(editingProduct.warranty_months != null ? String(editingProduct.warranty_months) : "");
  }, [editingProduct, warehouses, stocks]);

  // loading/loadError 匯總 effect 已搬到 AppContext

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

  // 每次 app 載入清理超過 180 天的已完成 / 已放棄 任務
  useEffect(() => {
    if (!userId) return;
    (async () => {
      const cutoff = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from("employee_tasks")
        .delete()
        .in("status", ["done", "abandoned"])
        .lt("completed_at", cutoff)
        .select("id");
      if (error) { console.error("任務 180 天清理失敗", error); return; }
      if (data && data.length > 0) {
        const ids = new Set(data.map(r => r.id));
        setTasks(prev => prev.filter(t => !ids.has(t.id)));
      }
    })();
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
    // 隱藏內部 marker：__FORMS_BUY__ / __PENDING_MERGE__:cid 等（雙下劃線包圍的全大寫詞，可帶 :id 後綴）
    let out = notes.replace(/__[A-Z_]+__(?::[\w-]+)?\s*/g, "");
    out = out.replace(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z/g, (_, y, mo, d, h, mi) => {
      const utc = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi));
      const hk = new Date(utc.getTime() + 8 * 60 * 60 * 1000);
      const pad = (n) => String(n).padStart(2, "0");
      return `${hk.getUTCFullYear()}-${pad(hk.getUTCMonth() + 1)}-${pad(hk.getUTCDate())} ${pad(hk.getUTCHours())}:${pad(hk.getUTCMinutes())}`;
    });
    return out.trim();
  };

  const getProduct = (id) => products.find(p => p.id === id);
  const getCustomer = (id) => customers.find(c => c.id === id);
  const fmtInvNum = (inv) => {
    const raw = String(inv.invoice_number || inv.id);
    const stripped = raw.replace(/^DC/i, "");
    // 純數字 → 補齊到 5 位（DC01502 / DC10532）；UUID fallback 不動
    const formatted = /^\d+$/.test(stripped) ? stripped.padStart(5, "0") : stripped;
    return `DC${formatted}`;
  };
  // 推斷發票來源（Shopify 直接訂單 / Framer 表單 / 百老匯 / 手動）
  const invoiceSource = (inv) => {
    const notes = inv?.notes || "";
    if (notes.includes("__BROADWAY__")) return { label: t("百老匯"), color: "#dc2626", bg: "#fee2e2" };
    if (notes.includes("__FORMS_BUY__")) return { label: "Framer", color: "#6382ff", bg: "#eef2ff" };
    // notes 空 + invoice_number 純數字 → 大概率 Shopify 同步進來的
    if (inv?.invoice_number && /^\d+$/.test(String(inv.invoice_number))) {
      return { label: "Shopify", color: "#16a34a", bg: "#dcfce7" };
    }
    return { label: t("手動"), color: "#888", bg: "#f5f5f5" };
  };
  // 從 notes 抽 __POSSIBLE_DUP__:{id} 標記（forms-buy 寫的，可能跟現有 Shopify 訂單重複）
  const getPossibleDupId = (inv) => {
    const m = (inv?.notes || "").match(/__POSSIBLE_DUP__:([\w-]+)/);
    return m ? m[1] : "";
  };
  // 月營收（當月）
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const monthlyRevenue = useMemo(() => invoices.filter(i => (i.date || "").startsWith(currentMonth) && (i.status || "").trim().toLowerCase() === "paid").reduce((s, i) => s + (i.total || 0), 0), [invoices, currentMonth]);
  const totalRevenue = invoices.reduce((s, i) => s + (i.total || 0), 0);
  const stockSummary = useMemo(() => {
    const byProd = {};
    for (const s of stocks) byProd[s.product_id] = (byProd[s.product_id] || 0) + (s.qty || 0);
    const activeIds = new Set(products.filter(p => p.category !== '_archived' && (p.status || 'active') !== 'discontinued').map(p => p.id));
    let skuCount = 0, totalQty = 0;
    for (const [pid, qty] of Object.entries(byProd)) {
      if (qty > 0 && activeIds.has(pid)) { skuCount++; totalQty += qty; }
    }
    return { skuCount, totalQty };
  }, [stocks, products]);
  const inStock = stockSummary.skuCount;

  // isNonWarrantyItem / itemWarrantyMonths 已抽到 src/lib/warranty.js
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
        const months = itemWarrantyMonths(item, prod);
        if (!months) continue;
        const wEnd = new Date(inv.date);
        wEnd.setMonth(wEnd.getMonth() + months);
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

  // 庫存不足 SKU（活 SKU + 非父 + 非停售 + 非虛擬 + 所有倉庫合計 <= 0）
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
      if ((p.status || 'active') === 'discontinued') return false;
      if (p.is_virtual === true) return false;
      return (byProd.get(p.id) || 0) <= 0;
    });
  }, [products, stocks]);

  // 庫存預警 SKU（活 SKU + 非父 + 非停售 + 非虛擬 + 合計 < 50）
  const LOW_STOCK_THRESHOLD = 50;
  const lowStockSkus = useMemo(() => {
    if (!products.length) return [];
    const parentIds = new Set(products.filter(x => x.parent_product_id).map(x => x.parent_product_id));
    const byProd = new Map();
    for (const s of stocks) {
      byProd.set(s.product_id, (byProd.get(s.product_id) || 0) + (s.qty || 0));
    }
    return products.filter(p => {
      if (p.category === '_archived') return false;
      if (parentIds.has(p.id)) return false;
      if ((p.status || 'active') === 'discontinued') return false;
      if (p.is_virtual === true) return false;
      return (byProd.get(p.id) || 0) < LOW_STOCK_THRESHOLD;
    }).map(p => ({ ...p, _stockQty: byProd.get(p.id) || 0 }));
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
        const months = itemWarrantyMonths(item, prod);
        if (!months) continue;
        const wEnd = new Date(inv.date);
        wEnd.setMonth(wEnd.getMonth() + months);
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
  const warrantyAlerts = allWarrantyItems;

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

  const navItems = [
    { id: "dashboard", label: t("總覽"), icon: "dashboard" },
    { id: "products", label: t("產品"), icon: "product" },
    { id: "customers", label: t("客戶"), icon: "customer" },
    { id: "invoices", label: t("發票"), icon: "invoice" },
    { id: "warranty", label: t("保修"), icon: "warning" },
    { id: "revenue", label: t("營收"), icon: "trend_up" },
    { id: "expense", label: t("報銷"), icon: "money" },
    { id: "gototeam", label: t("前往 team"), icon: "customer", external: "https://team.honnmono.top" },
    { id: "suppliers", label: t("供應商"), icon: "product" },
    { id: "whatsapp", label: t("WhatsApp"), icon: "invoice" },
    { id: "updatelog", label: t("更新日誌"), icon: "trend_up" },
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
      alert(`${t("新增客戶失敗")}：${error.message}`);
    }
    setSaving(false);
  }

  function handleMarkPaid(inv) {
    if ((inv.status || "").trim().toLowerCase() === "paid") return;
    const dupId = getPossibleDupId(inv);
    if (dupId) {
      const ok = window.confirm(`${t("此發票疑似與發票")} ${dupId} ${t("重複（2 天內 / 同 email / 同 phone / 同產品）")}\n\n${t("確認標 Paid 並扣庫存？")}\n${t("（如果確認重複請改用編輯刪除此單，避免重複扣庫存）")}`);
      if (!ok) return;
    }
    // channel: 'self' = 自有（默認，扣庫存）/ 'broadway' = 百老匯渠道（不扣庫存）
    const presetChannel = (inv.notes || "").includes("__BROADWAY__") ? "broadway" : "self";
    setMarkPaidCtx({ inv, defaultWh: warehouses[0]?.id || null, channel: presetChannel });
  }

  // 解析發票 items 成扣減計劃（走 line_item_aliases 映射，支持單品/套裝/skip）
  // legacy_skip_deduct=true 或 notes 含 __BROADWAY__ 的發票直接返回空計劃（不扣庫存）
  function buildDeductionPlan(inv, defaultWh) {
    if (inv.legacy_skip_deduct === true) return [{ name: t("歷史發票"), qty: 0, skip: true, reason: t("已標記為歷史，不扣庫存") }];
    if ((inv.notes || "").includes("__BROADWAY__")) return [{ name: t("百老匯渠道"), qty: 0, skip: true, reason: t("百老匯渠道：不扣本地庫存") }];
    let itemsArr = inv.items;
    if (typeof itemsArr === "string") { try { itemsArr = JSON.parse(itemsArr); } catch { itemsArr = []; } }
    if (!Array.isArray(itemsArr)) itemsArr = [];
    const parentIds = new Set(products.filter(x => x.parent_product_id).map(x => x.parent_product_id));
    const norm = (s) => (s || "").toLowerCase().trim();
    const aliasByName = new Map(lineItemAliases.map(a => [norm(a.alias_name), a]));
    const plan = [];
    for (const it of itemsArr) {
      const itemQty = Number(it.qty) || 0;
      const alias = aliasByName.get(norm(it.name));
      // 沒有 alias 映射 → 退回到「products.name 直接匹配」（兼容手動發票）
      if (!alias) {
        const prod = products.find(p => p.name === it.name);
        if (!prod) { plan.push({ name: it.name, qty: itemQty, skip: true, reason: t("未配 line item 映射") }); continue; }
        if (prod.is_virtual === true) { plan.push({ name: it.name, qty: itemQty, skip: true, reason: t("虛擬產品") }); continue; }
        if (prod.category === '_archived') { plan.push({ name: it.name, qty: itemQty, skip: true, reason: t("已歸檔老產品") }); continue; }
        if (parentIds.has(prod.id)) { plan.push({ name: it.name, qty: itemQty, skip: true, reason: t("父 SKU 不扣") }); continue; }
        const wid = it.warehouse_id || defaultWh;
        if (!wid) { plan.push({ name: it.name, qty: itemQty, skip: true, reason: t("無倉庫") }); continue; }
        const stock = stocks.find(s => s.product_id === prod.id && s.warehouse_id === wid);
        const current = stock?.qty || 0;
        plan.push({ product_id: prod.id, warehouse_id: wid, name: it.name, qty: itemQty, current, after: current - itemQty });
        continue;
      }
      // alias.skip=true → 押金/運費/Final Payment/租務，不扣
      if (alias.skip === true) { plan.push({ name: it.name, qty: itemQty, skip: true, reason: alias.note || t("alias 標記為不扣") }); continue; }
      // alias.products 是 [{product_id, qty}] 數組，套裝的話多條
      const aliasProducts = Array.isArray(alias.products) ? alias.products : [];
      if (aliasProducts.length === 0) { plan.push({ name: it.name, qty: itemQty, skip: true, reason: t("alias 未配產品") }); continue; }
      for (const ap of aliasProducts) {
        const prod = products.find(p => p.id === ap.product_id);
        if (!prod) { plan.push({ name: `${it.name} → ?`, qty: 0, skip: true, reason: t("alias 引用的產品已刪除") }); continue; }
        if (prod.category === '_archived') { plan.push({ name: `${it.name} → ${prod.name}`, qty: 0, skip: true, reason: t("已歸檔老產品") }); continue; }
        if (parentIds.has(prod.id)) { plan.push({ name: `${it.name} → ${prod.name}`, qty: 0, skip: true, reason: t("父 SKU 不扣") }); continue; }
        const wid = it.warehouse_id || defaultWh;
        if (!wid) { plan.push({ name: `${it.name} → ${prod.name}`, qty: 0, skip: true, reason: t("無倉庫") }); continue; }
        const perUnitQty = Number(ap.qty) || 1;
        const totalDeduct = perUnitQty * itemQty;
        const stock = stocks.find(s => s.product_id === prod.id && s.warehouse_id === wid);
        const current = stock?.qty || 0;
        plan.push({ product_id: prod.id, warehouse_id: wid, name: `${it.name} → ${prod.name}`, qty: totalDeduct, current, after: current - totalDeduct });
      }
    }
    return plan;
  }

  async function executeMarkPaid() {
    if (!markPaidCtx) return;
    const { inv, defaultWh, channel } = markPaidCtx;
    const isBroadway = channel === "broadway";

    // 百老匯渠道：notes 加 __BROADWAY__ 標記（防重複追加）+ 跳過所有扣減
    let nextNotes = inv.notes || "";
    if (isBroadway && !nextNotes.includes("__BROADWAY__")) {
      nextNotes = nextNotes ? `${nextNotes}\n__BROADWAY__` : "__BROADWAY__";
    }

    const plan = isBroadway ? [] : buildDeductionPlan(inv, defaultWh);
    const deductions = plan.filter(p => !p.skip && p.qty > 0);
    // 扣減 + 流水（百老匯渠道走不到這裡，deductions 為空）
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
    // 佣金 snapshot：標 Paid 時按當前規則 + 銷售人 算一次寫入。後續改規則不追溯
    const commissionAmount = computeCommissionFor(isBroadway ? { ...inv, notes: nextNotes } : inv, inv.salesperson_id, { products, lineItemAliases });
    const baseUpdates = { status: "Paid", commission_amount: commissionAmount };
    const updates = isBroadway ? { ...baseUpdates, notes: nextNotes } : baseUpdates;
    const { error } = await supabase.from("invoices").update(updates).eq("id", inv.id);
    if (error) { alert(`${t("標記失敗")}：${error.message}`); return; }
    setInvoices(prev => prev.map(i => i.id === inv.id ? { ...i, ...updates } : i));
    queryClient.setQueryData(["bf", "invoices"], (old) => Array.isArray(old) ? old.map(i => i.id === inv.id ? { ...i, ...updates } : i) : old);
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
      alert(`${t("此客戶有")} ${invCount} ${t("張發票，請先刪除該客戶的所有發票，再刪除客戶。")}`);
      return;
    }
    const msg = cids.length > 1
      ? `${t("確定刪除客戶")}「${c.name || t("(無名)")}」${t("及其合併的")} ${cids.length} ${t("條重複記錄？")}\n\n${t("此操作不可撤銷。")}`
      : `${t("確定刪除客戶")}「${c.name || t("(無名)")}」？\n\n${t("此操作不可撤銷。")}`;
    const confirmed = window.confirm(msg);
    if (!confirmed) return;
    const { error } = await supabase.from("customers").delete().in("id", cids);
    if (error) { alert(`${t("刪除客戶失敗")}：${error.message}`); return; }
    setCustomers(prev => prev.filter(x => !cids.includes(x.id)));
    setSelectedCustomer(null);
  }

  // ── 員工管理 ──────────────────────────────────────────────
  async function handleSaveEmployee() {
    if (!newEmployee.name.trim()) { alert(t("請輸入員工姓名")); return; }
    const { data, error } = await supabase.from("employees").insert({
      name: newEmployee.name.trim(),
      role: newEmployee.role.trim() || null,
      phone: newEmployee.phone.trim() || null,
      email: newEmployee.email.trim() || null,
      note: newEmployee.note.trim() || null,
    }).select().single();
    if (error) { alert(`${t("新增失敗")}：${error.message}`); return; }
    setEmployees(prev => [...prev, data]);
    setShowAddEmployee(false);
    setNewEmployee({ name: "", role: "", phone: "", email: "", note: "" });
  }

  async function handleDeleteEmployee(emp) {
    const taskCount = tasks.filter(t => t.employee_id === emp.id).length;
    const msg = taskCount > 0
      ? `${t("確定刪除員工")}「${emp.name}」？\n${t("將同時刪除其")} ${taskCount} ${t("條任務記錄。此操作不可撤銷。")}`
      : `${t("確定刪除員工")}「${emp.name}」？${t("此操作不可撤銷。")}`;
    if (!window.confirm(msg)) return;
    const { error } = await supabase.from("employees").delete().eq("id", emp.id);
    if (error) { alert(`${t("刪除失敗")}：${error.message}`); return; }
    const deletedTaskIds = new Set(tasks.filter(t => t.employee_id === emp.id).map(t => t.id));
    setEmployees(prev => prev.filter(e => e.id !== emp.id));
    setTasks(prev => prev.filter(t => t.employee_id !== emp.id));
    setTaskAssignees(prev => prev.filter(a => !deletedTaskIds.has(a.task_id) && a.employee_id !== emp.id));
    setSelectedEmployee(null);
  }

  async function handleSaveSupplier() {
    if (!newSupplier.name?.trim()) return;
    const payload = {
      name: newSupplier.name.trim(),
      contact_url: newSupplier.contact_url?.trim() || null,
      contact_person: newSupplier.contact_person?.trim() || null,
      category: newSupplier.category?.trim() || null,
      note: newSupplier.note?.trim() || null,
    };
    const { data, error } = await supabase.from("suppliers").insert(payload).select().single();
    if (error) { alert(`${t("新增失敗")}：${error.message}`); return; }
    setSuppliers(prev => [data, ...prev]);
    queryClient.setQueryData(["bf", "suppliers"], (old) => Array.isArray(old) ? [data, ...old] : [data]);
    setNewSupplier({ name: "", contact_url: "", contact_person: "", category: "", note: "" });
    setShowAddSupplier(false);
  }
  async function handleUpdateSupplier(id, patch) {
    const finalPatch = { ...patch, updated_at: new Date().toISOString() };
    const { error } = await supabase.from("suppliers").update(finalPatch).eq("id", id);
    if (error) { alert(`${t("更新失敗")}：${error.message}`); return; }
    setSuppliers(prev => prev.map(s => s.id === id ? { ...s, ...finalPatch } : s));
    queryClient.setQueryData(["bf", "suppliers"], (old) => Array.isArray(old) ? old.map(s => s.id === id ? { ...s, ...finalPatch } : s) : old);
  }
  async function handleDeleteSupplier(id) {
    if (!window.confirm(t("確定刪除此供應商？"))) return;
    const { error } = await supabase.from("suppliers").delete().eq("id", id);
    if (error) { alert(`${t("刪除失敗")}：${error.message}`); return; }
    setSuppliers(prev => prev.filter(s => s.id !== id));
    queryClient.setQueryData(["bf", "suppliers"], (old) => Array.isArray(old) ? old.filter(s => s.id !== id) : old);
    setEditingSupplier(null);
  }

  async function handleAddTask(employeeId, title, priority = "low", parentTaskId = null, note = null, files = [], opts = {}) {
    // opts: { assigneeIds?: string[], needsApproval?: boolean }
    //   - assigneeIds: 多人分配（Phase 2 用），不傳則 fallback employeeId 單人
    //   - needsApproval: 是否需要發布人核驗
    if (!title || !title.trim()) return;
    const assigneeIds = (opts.assigneeIds && opts.assigneeIds.length > 0)
      ? opts.assigneeIds
      : (employeeId ? [employeeId] : []);
    const primaryEmployeeId = assigneeIds[0] || employeeId || null;
    const { data, error } = await supabase.from("employee_tasks").insert({
      employee_id: primaryEmployeeId,             // 保留作主負責人（兼容舊邏輯）
      creator_employee_id: currentEmployee?.id || primaryEmployeeId,
      needs_approval: !!opts.needsApproval,
      title: title.trim(),
      priority,
      parent_task_id: parentTaskId,
      note: note || null,
    }).select().single();
    if (error) { alert(`${t("新增任務失敗")}：${error.message}`); return; }
    let row = data;
    // 同步寫 task_assignees（多人分配的真實來源）
    if (assigneeIds.length > 0) {
      const rows = assigneeIds.map(eid => ({ task_id: data.id, employee_id: eid }));
      const { data: ad, error: ae } = await supabase.from("task_assignees").insert(rows).select();
      if (ae) {
        console.error("task_assignees insert failed", ae);
      } else if (ad && ad.length > 0) {
        setTaskAssignees(prev => [...prev, ...ad]);
      }
    }
    // 有附件就上傳到新建 task 下，再 UPDATE attachments 列
    if (files && files.length > 0) {
      try {
        const attachments = await Promise.all(files.map(f => uploadAttachment(f, data.id)));
        const { data: upd, error: e2 } = await supabase.from("employee_tasks").update({ attachments }).eq("id", data.id).select().single();
        if (e2) { alert(`${t("附件保存失敗")}：${e2.message}`); }
        else { row = upd; }
      } catch (e) { alert(`${t("附件上傳失敗")}：${e.message}`); }
    }
    setTasks(prev => [...prev, row]);
    return row;
  }

  // 重新設置 task 的 assignees（diff 增刪），同步 employee_tasks.employee_id 為主負責人（= 第一個 assignee，保留兼容老查詢）
  async function handleSetTaskAssignees(taskId, newAssigneeIds) {
    if (newAssigneeIds.length === 0) { alert(t("至少需要一個負責人")); return; }
    const current = (assigneesByTask.get(taskId) || []).map(a => a.employee_id);
    const toAdd = newAssigneeIds.filter(id => !current.includes(id));
    const toRemove = current.filter(id => !newAssigneeIds.includes(id));
    if (toAdd.length > 0) {
      const rows = toAdd.map(eid => ({ task_id: taskId, employee_id: eid }));
      const { data, error } = await supabase.from("task_assignees").insert(rows).select();
      if (error) { alert(`${t("分配失敗")}：${error.message}`); return; }
      if (data && data.length > 0) setTaskAssignees(prev => [...prev, ...data]);
    }
    if (toRemove.length > 0) {
      const { error } = await supabase.from("task_assignees").delete().eq("task_id", taskId).in("employee_id", toRemove);
      if (error) { alert(`${t("移除失敗")}：${error.message}`); return; }
      setTaskAssignees(prev => prev.filter(a => !(a.task_id === taskId && toRemove.includes(a.employee_id))));
    }
    // 同步 employee_tasks.employee_id 為新主負責人（= 第一個 assignee）
    const task = tasks.find(x => x.id === taskId);
    const newPrimary = newAssigneeIds[0];
    if (task && task.employee_id !== newPrimary) {
      await handleUpdateTask(taskId, { employee_id: newPrimary });
    }
  }

  async function handleUpdateTask(taskId, patch) {
    const { error } = await supabase.from("employee_tasks").update(patch).eq("id", taskId);
    if (error) { alert(`${t("更新失敗")}：${error.message}`); return; }
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, ...patch } : t));
    // prev 可能在 async 期間被 setEditingTask(null) 改成 null（用戶點完成關 modal 時 onBlur 後 update 才回來），
    // 要 guard：prev 為 null 或不是同一 task 時保持原樣不要 merge 進空白對象（避免空白 modal 重彈）
    setEditingTask(prev => (prev && prev.id === taskId) ? ({ ...prev, ...patch }) : prev);
  }

  async function handleToggleTaskDone(task) {
    // 兼容單人 / 舊數據：toggle task.status 並同步唯一 assignee 的 completed_at
    const next = task.status === "done" ? "open" : "done";
    const ts = next === "done" ? new Date().toISOString() : null;
    await handleUpdateTask(task.id, { status: next, completed_at: ts });
    const list = assigneesByTask.get(task.id) || [];
    if (list.length >= 1) {
      // 全部 assignee 的 completed_at 跟 task 同步（單人就一條，多人也一致地全部跟齊）
      await supabase.from("task_assignees").update({ completed_at: ts }).eq("task_id", task.id);
      setTaskAssignees(prev => prev.map(a => a.task_id === task.id ? { ...a, completed_at: ts } : a));
    }
  }

  // 發布人 / admin 核驗通過：根據 assignees 是否有人 done 決定最終 task.status (done / abandoned)
  async function handleApproveTask(task) {
    const list = assigneesByTask.get(task.id) || [];
    const anyDone = list.some(a => a.completed_at != null);
    const nextStatus = anyDone ? "done" : "abandoned";
    const now = new Date().toISOString();
    await handleUpdateTask(task.id, {
      status: nextStatus,
      completed_at: now,
      approved_at: now,
      approved_by: currentEmployee?.id || null,
    });
  }

  // toggle 某員工對某 task 的個人放棄狀態
  // 單人 + 不需核驗：直接 task.status='abandoned'
  // 多人 / 需核驗：只設 abandoned_at，task.status 不變；不需核驗時全員結算後自動 set task.status
  async function handleToggleAssigneeAbandoned(task, empId) {
    const list = assigneesByTask.get(task.id) || [];
    const myRow = list.find(a => a.employee_id === empId);
    if (!myRow) {
      // 沒 assignee 行 → fallback 改 task.status
      const next = task.status === "abandoned" ? "open" : "abandoned";
      const ts = next === "abandoned" ? new Date().toISOString() : null;
      return handleUpdateTask(task.id, { status: next, completed_at: ts });
    }
    // 單人獨佔 + 不需核驗 → 整體 abandoned
    if (list.length === 1 && !task.needs_approval) {
      const next = task.status === "abandoned" ? "open" : "abandoned";
      const ts = next === "abandoned" ? new Date().toISOString() : null;
      await handleUpdateTask(task.id, { status: next, completed_at: ts });
      await supabase.from("task_assignees").update({ abandoned_at: ts, completed_at: null }).eq("task_id", task.id).eq("employee_id", empId);
      setTaskAssignees(prev => prev.map(a => (a.task_id === task.id && a.employee_id === empId) ? { ...a, abandoned_at: ts, completed_at: null } : a));
      return;
    }
    // 多人 / 需核驗：toggle 個人 abandoned_at（同時清掉 completed_at 互斥）
    const nextTs = myRow.abandoned_at ? null : new Date().toISOString();
    const newCompletedAt = nextTs ? null : myRow.completed_at;
    const { error } = await supabase.from("task_assignees").update({ abandoned_at: nextTs, completed_at: newCompletedAt }).eq("task_id", task.id).eq("employee_id", empId);
    if (error) { alert(`${t("更新失敗")}：${error.message}`); return; }
    setTaskAssignees(prev => prev.map(a => (a.task_id === task.id && a.employee_id === empId) ? { ...a, abandoned_at: nextTs, completed_at: newCompletedAt } : a));
    // auto-status：不需核驗 + 全員結算 → 算 task 整體
    if (!task.needs_approval) {
      const updatedList = list.map(a => a.employee_id === empId ? { ...a, abandoned_at: nextTs, completed_at: newCompletedAt } : a);
      const allSettled = updatedList.every(a => a.completed_at != null || a.abandoned_at != null);
      if (allSettled) {
        const anyDone = updatedList.some(a => a.completed_at != null);
        if (anyDone && task.status !== "done") {
          await handleUpdateTask(task.id, { status: "done", completed_at: new Date().toISOString() });
        } else if (!anyDone && task.status !== "abandoned") {
          await handleUpdateTask(task.id, { status: "abandoned", completed_at: new Date().toISOString() });
        }
      } else if (task.status !== "open") {
        // 有人取消放棄 → 任務回到 open
        await handleUpdateTask(task.id, { status: "open", completed_at: null });
      }
    }
  }

  // toggle 某員工對某 task 的個人完成狀態（用於多人任務）
  async function handleToggleAssigneeDone(task, empId) {
    const list = assigneesByTask.get(task.id) || [];
    const myRow = list.find(a => a.employee_id === empId);
    if (!myRow) {
      // 任務沒有這個 emp 的 assignee 行（舊數據）→ fallback 改 task.status
      return handleToggleTaskDone(task);
    }
    const nextTs = myRow.completed_at ? null : new Date().toISOString();
    const { error } = await supabase.from("task_assignees").update({ completed_at: nextTs }).eq("task_id", task.id).eq("employee_id", empId);
    if (error) { alert(`${t("更新失敗")}：${error.message}`); return; }
    setTaskAssignees(prev => prev.map(a => (a.task_id === task.id && a.employee_id === empId) ? { ...a, completed_at: nextTs } : a));
    // 全員完成 + 不需核驗 → auto-set task.status=done；任一未完成 + task.status=done → 回退到 open
    const updatedList = list.map(a => a.employee_id === empId ? { ...a, completed_at: nextTs } : a);
    const allDone = updatedList.every(a => a.completed_at != null);
    if (allDone && !task.needs_approval && task.status !== "done") {
      await handleUpdateTask(task.id, { status: "done", completed_at: new Date().toISOString() });
    } else if (!allDone && task.status === "done") {
      await handleUpdateTask(task.id, { status: "open", completed_at: null });
    }
  }

  async function handleDeleteTask(taskId) {
    const task = tasks.find(x => x.id === taskId);
    if (!canDeleteTask(task)) { alert(t("無權刪除此任務（只有管理員、發布人、或單獨被分配且不需核驗的人能刪）")); return; }
    if (!window.confirm(t("確定刪除此任務及所有子任務？"))) return;
    const subIds = tasks.filter(s => s.parent_task_id === taskId).map(s => s.id);
    const allDeleted = new Set([taskId, ...subIds]);
    const { error } = await supabase.from("employee_tasks").delete().eq("id", taskId);
    if (error) { alert(`${t("刪除失敗")}：${error.message}`); return; }
    setTasks(prev => prev.filter(t => !allDeleted.has(t.id)));
    setFeedbacks(prev => prev.filter(f => !allDeleted.has(f.task_id))); // CASCADE 在 db 自动删，本地也同步
    setTaskAssignees(prev => prev.filter(a => !allDeleted.has(a.task_id))); // 同步清理 assignees
    if (editingTask?.id === taskId) setEditingTask(null);
  }

  // ── 任務反饋 (comments thread) ─────────────────────────────
  // 上傳單個附件到 task-attachments storage bucket，返回 {url, name, size, type}
  async function uploadAttachment(file, taskId) {
    const ext = (file.name.split(".").pop() || "bin").toLowerCase();
    const path = `${taskId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await supabase.storage.from("task-attachments").upload(path, file, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
    if (error) throw error;
    const { data: pub } = supabase.storage.from("task-attachments").getPublicUrl(path);
    return { url: pub.publicUrl, name: file.name, size: file.size, type: file.type || "application/octet-stream" };
  }

  async function handleAddFeedback(taskId, body, files = [], parentFeedbackId = null, mentionedUserIds = []) {
    if ((!body || !body.trim()) && (!files || files.length === 0)) return;
    if (!userId) return;
    const authorName = currentEmployee?.name || (session?.user?.email ? session.user.email.split("@")[0] : "user");
    let attachments = null;
    try {
      if (files && files.length > 0) {
        attachments = await Promise.all(files.map(f => uploadAttachment(f, taskId)));
      }
    } catch (e) { alert(`${t("附件上傳失敗")}：${e.message}`); return; }
    // 回復別人的反饋 → 自動 @ 原作者（除非是自己回自己）
    let finalMentions = Array.isArray(mentionedUserIds) ? [...mentionedUserIds] : [];
    if (parentFeedbackId) {
      const parent = feedbacks.find(f => f.id === parentFeedbackId);
      if (parent && parent.author_user_id && parent.author_user_id !== userId && !finalMentions.includes(parent.author_user_id)) {
        finalMentions.push(parent.author_user_id);
      }
    }
    const { data, error } = await supabase.from("employee_task_feedbacks").insert({
      task_id: taskId,
      author_user_id: userId,
      author_name: authorName,
      body: (body || "").trim(),
      attachments,
      parent_feedback_id: parentFeedbackId,
      mentioned_user_ids: finalMentions,
    }).select().single();
    if (error) { alert(`${t("發送失敗")}：${error.message}`); return; }
    setFeedbacks(prev => [...prev, data]);
    setPendingAttachments([]);
    setPendingMentions([]);
    setReplyingToFb(null);
    return data;
  }

  async function handleDeleteFeedback(fbId) {
    if (!window.confirm(t("確定刪除此反饋？"))) return;
    const { error } = await supabase.from("employee_task_feedbacks").delete().eq("id", fbId);
    if (error) { alert(`${t("刪除失敗")}：${error.message}`); return; }
    setFeedbacks(prev => prev.filter(f => f.id !== fbId));
  }

  // ====== 員工更新日誌 handlers ======
  async function handleAddUpdateLog(employeeId, summary, detail) {
    if (!summary || !summary.trim()) return;
    const { data, error } = await supabase.from("employee_update_logs").insert({
      employee_id: employeeId,
      summary: summary.trim(),
      detail: (detail || "").trim() || null,
    }).select().single();
    if (error) { alert(`${t("新增失敗")}：${error.message}`); return; }
    setUpdateLogs(prev => [data, ...prev]);
    queryClient.setQueryData(["bf", "employee_update_logs"], (old) => Array.isArray(old) ? [data, ...old] : [data]);
    return data;
  }

  async function handleUpdateUpdateLog(logId, patch) {
    const finalPatch = { ...patch, updated_at: new Date().toISOString() };
    const { data, error } = await supabase.from("employee_update_logs").update(finalPatch).eq("id", logId).select().single();
    if (error) { alert(`${t("保存失敗")}：${error.message}`); return; }
    setUpdateLogs(prev => prev.map(l => l.id === logId ? data : l));
    queryClient.setQueryData(["bf", "employee_update_logs"], (old) => Array.isArray(old) ? old.map(l => l.id === logId ? data : l) : old);
  }

  async function handleDeleteUpdateLog(logId) {
    if (!window.confirm(t("確定刪除此更新及所有評論？"))) return;
    const { error } = await supabase.from("employee_update_logs").delete().eq("id", logId);
    if (error) { alert(`${t("刪除失敗")}：${error.message}`); return; }
    setUpdateLogs(prev => prev.filter(l => l.id !== logId));
    setLogComments(prev => prev.filter(c => c.update_log_id !== logId));
    queryClient.setQueryData(["bf", "employee_update_logs"], (old) => Array.isArray(old) ? old.filter(l => l.id !== logId) : old);
    queryClient.setQueryData(["bf", "employee_update_log_comments"], (old) => Array.isArray(old) ? old.filter(c => c.update_log_id !== logId) : old);
  }

  async function handleAddLogComment(updateLogId, body, parentCommentId = null) {
    if (!body || !body.trim() || !userId) return;
    const authorName = currentEmployee?.name || (session?.user?.email ? session.user.email.split("@")[0] : "user");
    const { data, error } = await supabase.from("employee_update_log_comments").insert({
      update_log_id: updateLogId,
      author_user_id: userId,
      author_name: authorName,
      body: body.trim(),
      parent_comment_id: parentCommentId,
    }).select().single();
    if (error) { alert(`${t("發送失敗")}：${error.message}`); return; }
    setLogComments(prev => [...prev, data]);
    queryClient.setQueryData(["bf", "employee_update_log_comments"], (old) => Array.isArray(old) ? [...old, data] : [data]);
    return data;
  }

  async function handleUpdateLogComment(commentId, body) {
    if (!body || !body.trim()) return;
    const { data, error } = await supabase.from("employee_update_log_comments").update({ body: body.trim(), updated_at: new Date().toISOString() }).eq("id", commentId).select().single();
    if (error) { alert(`${t("保存失敗")}：${error.message}`); return; }
    setLogComments(prev => prev.map(c => c.id === commentId ? data : c));
    queryClient.setQueryData(["bf", "employee_update_log_comments"], (old) => Array.isArray(old) ? old.map(c => c.id === commentId ? data : c) : old);
  }

  async function handleDeleteLogComment(commentId) {
    if (!window.confirm(t("確定刪除此評論？"))) return;
    const { error } = await supabase.from("employee_update_log_comments").delete().eq("id", commentId);
    if (error) { alert(`${t("刪除失敗")}：${error.message}`); return; }
    setLogComments(prev => prev.filter(c => c.id !== commentId));
    queryClient.setQueryData(["bf", "employee_update_log_comments"], (old) => Array.isArray(old) ? old.filter(c => c.id !== commentId) : old);
  }

  // handleSaveAlias / handleDeleteAlias / handleVerifyAlias 已搬到 ProductsListView 本地

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
      if (!loginEmail || !loginPw) { setLoginError(t("請輸入郵箱和密碼")); return; }
      setLoginBusy(true);
      setLoginError("");
      const { error } = await supabase.auth.signInWithPassword({ email: loginEmail, password: loginPw });
      if (error) setLoginError(error.message || t("登入失敗"));
      setLoginBusy(false);
    };
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "linear-gradient(135deg,#1a1f3a,#2d3561)" }}>
        <div style={{ background: "#fff", borderRadius: 16, padding: 40, width: 380, boxShadow: "0 10px 40px rgba(0,0,0,0.2)" }}>
          <div style={{ textAlign: "center", marginBottom: 28 }}>
            <div style={{ width: 56, height: 56, margin: "0 auto 14px", borderRadius: "50%", background: "linear-gradient(135deg,#6382ff,#a78bfa)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, fontWeight: 800, color: "#fff" }}>H</div>
            <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>Honnmono BizFlow</h2>
            <p style={{ margin: "6px 0 0", fontSize: 13, color: "#888" }}>{t("管理員登入")}</p>
          </div>
          <input
            type="email"
            autoFocus
            value={loginEmail}
            onChange={e => { setLoginEmail(e.target.value); setLoginError(""); }}
            onKeyDown={e => { if (e.key === "Enter") tryLogin(); }}
            placeholder={t("郵箱")}
            disabled={loginBusy}
            style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: "1px solid #e0e0e0", fontSize: 15, outline: "none", boxSizing: "border-box", marginBottom: 10 }}
          />
          <input
            type="password"
            value={loginPw}
            onChange={e => { setLoginPw(e.target.value); setLoginError(""); }}
            onKeyDown={e => { if (e.key === "Enter") tryLogin(); }}
            placeholder={t("密碼")}
            disabled={loginBusy}
            style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: loginError ? "1px solid #ef4444" : "1px solid #e0e0e0", fontSize: 15, outline: "none", boxSizing: "border-box", marginBottom: 8 }}
          />
          {loginError && <div style={{ color: "#ef4444", fontSize: 13, marginBottom: 8 }}>{loginError}</div>}
          <button onClick={tryLogin} disabled={loginBusy} style={{ width: "100%", padding: 12, background: loginBusy ? "#b0c0ff" : "#6382ff", color: "#fff", border: "none", borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: loginBusy ? "wait" : "pointer", marginTop: 8 }}>
            {loginBusy ? t("登入中...") : t("登入")}
          </button>
        </div>
      </div>
    );
  }

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", flexDirection: "column", gap: 16, background: "#f7f8fc" }}>
      <div style={{ width: 48, height: 48, border: "4px solid #e0e0e0", borderTopColor: "#6382ff", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <div style={{ color: "#888", fontSize: 15 }}>{t("正在載入 BizFlow...")}</div>
    </div>
  );

  if (loadError) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", flexDirection: "column", gap: 16, background: "#f7f8fc", padding: 40 }}>
      <div style={{ fontSize: 48 }}>⚠️</div>
      <div style={{ color: "#d32f2f", fontSize: 18, fontWeight: 700 }}>{t("資料載入失敗")}</div>
      <div style={{ color: "#666", fontSize: 13, maxWidth: 500, textAlign: "center", wordBreak: "break-all" }}>{loadError}</div>
      <button onClick={() => window.location.reload()} style={{ padding: "10px 24px", background: "#6382ff", color: "#fff", border: "none", borderRadius: 8, fontSize: 14, cursor: "pointer" }}>{t("重新載入")}</button>
    </div>
  );

  // 扩展更新 toast 計算（全局浮動，任何 tab 都可見）
  const _latestExtVer = qWaSettings.data?.latest_ext_version || LATEST_EXT_VERSION_FALLBACK;
  const _outdatedClients = (waClients || [])
    .filter(c => Date.now() - new Date(c.last_seen).getTime() < 25000)
    .filter(c => c.version && c.version !== _latestExtVer);
  const _showUpdateToast = _outdatedClients.length > 0 && extUpdateToastDismissedFor !== _latestExtVer;

  // task kind 用戶不能進 bizflow，引導去 team.honnmono.top
  if (currentEmployee && currentEmployee.kind === "task") {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", flexDirection: "column", gap: 20, background: "#f7f8fc", padding: 40, fontFamily: "'DM Sans','Helvetica Neue',sans-serif" }}>
        <div style={{ fontSize: 48 }}>🚧</div>
        <div style={{ color: "#222", fontSize: 22, fontWeight: 700 }}>{t("此帳號僅可使用團隊任務管理")}</div>
        <div style={{ color: "#666", fontSize: 14, maxWidth: 460, textAlign: "center", lineHeight: 1.6 }}>
          {t("你的帳號類型為 task，只能使用 team.honnmono.top 的任務管理功能，無法訪問主業務後台。")}
        </div>
        <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
          <a href="https://team.honnmono.top" style={{ padding: "12px 28px", background: "#6382ff", color: "#fff", borderRadius: 10, textDecoration: "none", fontSize: 14, fontWeight: 700 }}>{t("前往 team.honnmono.top")}</a>
          <button onClick={async () => { await supabase.auth.signOut(); }} style={{ padding: "12px 28px", background: "#fff", color: "#666", border: "1px solid #e0e0e0", borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>{t("登出")}</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", height: "100vh", fontFamily: "'DM Sans','Helvetica Neue',sans-serif", background: "#f7f8fc", color: "#1a1a2e" }}>

      {/* 扩展更新 toast — 全局右下角浮動 */}
      {_showUpdateToast && (
        <div style={{ position: "fixed", bottom: 20, right: 20, zIndex: 9999, background: "#fff", border: "2px solid #ef4444", borderRadius: 12, padding: "14px 18px", maxWidth: 340, fontSize: 13, lineHeight: 1.6, boxShadow: "0 8px 24px rgba(239,68,68,0.25)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
            <div>
              <div style={{ fontWeight: 700, color: "#c0392b", marginBottom: 6 }}>⚠️ {t("扩展有新版本")}</div>
              <div style={{ color: "#333" }}>
                {_outdatedClients.length} {t("個在線客戶端使用舊版（")}
                {[...new Set(_outdatedClients.map(c => c.version))].map(v => `v${v}`).join(", ")}
                {t("），最新")} <b style={{ color: "#c0392b" }}>v{_latestExtVer}</b>
              </div>
              <div style={{ fontSize: 11, color: "#888", marginTop: 6 }}>{t("請通知對方到「設置/模式」tab 重新下載")}</div>
            </div>
            <button
              onClick={() => setExtUpdateToastDismissedFor(_latestExtVer)}
              style={{ background: "transparent", border: "none", color: "#999", fontSize: 18, cursor: "pointer", padding: 0, lineHeight: 1 }}
            >×</button>
          </div>
        </div>
      )}

      {/* SIDEBAR */}
      <aside style={{ width: 220, background: "#1a1a2e", display: "flex", flexDirection: "column", flexShrink: 0 }}>
        <div style={{ padding: "20px 18px", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
          <img src={`data:image/png;base64,${LOGO_B64}`} style={{ width: "100%", maxHeight: 36, objectFit: "contain", filter: "invert(1)" }} />
          <div style={{ fontSize: 10, color: "#6b7bb8", marginTop: 6, letterSpacing: "0.1em", textTransform: "uppercase" }}>{t("業務管理系統")}</div>
          <div style={{ display: "flex", gap: 4, marginTop: 12, padding: 3, background: "rgba(99,130,255,0.1)", borderRadius: 8 }}>
            {[{ v: "zh", l: "繁體中文" }, { v: "en", l: "English" }, { v: "fr", l: "Français" }].map(opt => (
              <button key={opt.v} onClick={() => setLang(opt.v)} title={opt.l}
                style={{ flex: 1, padding: "5px 6px", border: "none", borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: "pointer", background: lang === opt.v ? "#7c9dff" : "transparent", color: lang === opt.v ? "#fff" : "#8899cc" }}>
                {opt.l}
              </button>
            ))}
          </div>
        </div>
        {warrantyAlerts.length > 0 && (
          <div onClick={() => setTab("warranty")} style={{ margin: "10px 12px", background: "#ff9800", borderRadius: 10, padding: "8px 12px", display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <Icon name="warning" size={13} />
            <div style={{ color: "#fff", fontSize: 12, fontWeight: 600 }}>{warrantyAlerts.length} {t("件保修需跟進")}</div>
          </div>
        )}
        <nav style={{ flex: 1, padding: "10px 8px", display: "flex", flexDirection: "column", gap: 2 }}>
          {navItems.map(n => (
            <button key={n.id} onClick={() => {
              if (n.external) { window.location.href = n.external; return; }
              setTab(n.id); setSelectedCustomer(null); setSearch("");
            }} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 14px", borderRadius: 10, border: "none", cursor: "pointer", background: tab === n.id ? "rgba(99,130,255,0.18)" : "transparent", color: tab === n.id ? "#7c9dff" : "#8899cc", fontSize: 14, fontWeight: tab === n.id ? 700 : 500, textAlign: "left" }}>
              <Icon name={n.icon} size={17} />{n.label}
            </button>
          ))}
        </nav>
        <div style={{ padding: "14px 12px", borderTop: "1px solid rgba(255,255,255,0.07)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", background: "rgba(99,130,255,0.1)", borderRadius: 10 }}>
            <div style={{ width: 30, height: 30, borderRadius: "50%", background: "linear-gradient(135deg,#7c9dff,#a78bfa)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "#fff" }}>{(currentEmployee?.name || session?.user?.email || "H").charAt(0).toUpperCase()}</div>
            <div style={{ flex: 1, overflow: "hidden" }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{currentEmployee?.name || session?.user?.email || "Honnmono"}</div>
              <div style={{ fontSize: 11, color: "#6b7bb8", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{currentEmployee?.role || currentEmployee?.email || session?.user?.email || ""}</div>
            </div>
            <button
              onClick={async () => { await supabase.auth.signOut(); }}
              title={t("登出")}
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
              <h1 style={{ fontSize: 26, fontWeight: 800, margin: 0 }}>{t("早安 👋")}</h1>
              <p style={{ color: "#888", margin: "4px 0 0", fontSize: 15 }}>{t("以下是 Honnmono 今日的業務概況。")}</p>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 16 }}>
              <StatCard label={t("本月營收")} value={`HKD$${monthlyRevenue.toLocaleString()}`} sub={lang === "en" ? `${now.toLocaleString("en", { month: "long", year: "numeric" })}` : lang === "fr" ? `${now.toLocaleString("fr", { month: "long", year: "numeric" })}` : `${now.getFullYear()}年${now.getMonth() + 1}月`} accent="#6382ff" icon={<Icon name="trend_up" size={20} />} onClick={() => setTab("revenue")} />
              <StatCard label={t("庫存數量")} value={inStock} sub={lowStockSkus.length > 0 ? `${t("共")} ${stockSummary.totalQty} ${t("件")} · ⚠ ${lowStockSkus.length} ${t("件低庫存")}` : `${t("共")} ${stockSummary.totalQty} ${t("件")}`} accent={lowStockSkus.length > 0 ? "#f59e0b" : "#22c55e"} icon={<Icon name="inventory" size={20} />} onClick={() => setTab("products")} />
              <StatCard label={t("客戶數")} value={customerGroups.virtualCustomers.filter(c => c.allEmails.length > 0 || c.allPhones.length > 0).length} sub={t("累計")} accent="#f59e0b" icon={<Icon name="customer" size={20} />} onClick={() => { setTab("customers"); setSelectedCustomer(null); }} />
              <StatCard label={t("保修提醒")} value={warrantyAlerts.length} sub={t("需跟進")} accent="#ef4444" icon={<Icon name="warning" size={20} />} onClick={() => setTab("warranty")} />
            </div>
            {/* 物流 3 卡（dashboard 第二行） */}
            {(() => {
              const paidInvoices = invoices.filter(i => (i.status || "").trim().toLowerCase() === "paid");
              // 待發貨 dashboard 卡：跟列表 filter 對齊，只算啟用日期之後的（避免 4500+ 張歷史 NULL 全進來）
              const pending = paidInvoices.filter(i => deriveShippingStatus(i) === '待發貨' && isShippingTrackable(i)).length;
              const inTransit = paidInvoices.filter(i => ['已發貨','在途','派送中'].includes(deriveShippingStatus(i))).length;
              const fourteenDaysAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
              const overdue = paidInvoices.filter(i => {
                const ss = deriveShippingStatus(i);
                if (!['已發貨','在途','派送中'].includes(ss)) return false;
                if (!i.shipped_at) return false;
                return new Date(i.shipped_at).getTime() < fourteenDaysAgo;
              }).length;
              const goShipping = (k) => {
                sessionStorage.setItem('invoices.initialShippingFilter', k);
                setTab("invoices");
                setSelectedCustomer(null);
                setSearch("");
              };
              return (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 28 }}>
                  <StatCard label={t("待發貨")} value={pending} sub={t("已付款待出庫")} accent="#888" icon={<Icon name="inventory" size={20} />} onClick={() => goShipping("pending")} />
                  <StatCard label={t("運送中")} value={inTransit} sub={t("已發貨待簽收")} accent="#6382ff" icon={<Icon name="trend_up" size={20} />} onClick={() => goShipping("in_transit")} />
                  <StatCard label={t("超期未簽")} value={overdue} sub={`> 14 ${t("天未簽收")}`} accent="#ef4444" icon={<Icon name="warning" size={20} />} onClick={() => goShipping("in_transit")} />
                </div>
              );
            })()}
            <div style={{ position: "relative", marginBottom: 20 }}>
              <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #f0f0f0", padding: "10px 14px", display: "flex", alignItems: "center", gap: 8 }}>
                <Icon name="search" size={15} />
                <input placeholder={t("搜尋發票、客戶、產品...")} value={dashSearch} onChange={e => setDashSearch(e.target.value)} style={{ border: "none", background: "none", outline: "none", fontSize: 14, width: "100%" }} />
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
                if (total === 0) return (<div style={{ ...panelStyle, padding: 20, textAlign: "center", color: "#999", fontSize: 13 }}>{t("沒有符合的結果")}</div>);
                return (
                  <div style={panelStyle}>
                    {custMatches.length > 0 && <>
                      <div style={hdrStyle}>{t("客戶")}（{custMatches.length}）</div>
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
                      <div style={hdrStyle}>{t("產品")}（{prodMatches.length}）</div>
                      {prodMatches.map(p => (
                        <div key={"p" + p.id} onClick={() => { setTab("products"); setDashSearch(""); }} style={rowStyle} onMouseEnter={e => e.currentTarget.style.background = "#f7f8fc"} onMouseLeave={e => e.currentTarget.style.background = "#fff"}>
                          <div style={{ fontSize: 20, width: 32, textAlign: "center" }}>📦</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 700, fontSize: 13 }}>{p.name}</div>
                            <div style={{ fontSize: 11, color: "#888" }}>HKD${p.price} · {t("保修")} {p.warranty_months || "—"} {t("月")}</div>
                          </div>
                        </div>
                      ))}
                    </>}
                    {invMatches.length > 0 && <>
                      <div style={hdrStyle}>{t("發票")}（{invMatches.length}）</div>
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
                  <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{t("最近發票")}</h2>
                  <button onClick={() => setTab("invoices")} style={{ fontSize: 13, color: "#6382ff", background: "none", border: "none", cursor: "pointer", fontWeight: 600 }}>{t("查看全部 →")}</button>
                </div>
                {invoices.slice(0, 5).map(inv => {
                  const c = getCustomer(inv.customer_id);
                  return (
                    <div key={inv.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 0", borderBottom: "1px solid #f5f5f5" }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>{fmtInvNum(inv)}</div>
                        <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>{(c?.phone || c?.phone_mainland) ? `${c.phone || c.phone_mainland} · ` : ""}{c?.name || "—"} · {inv.date || t("日期未知")}</div>
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
                  <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{t("🔔 保修提醒")}</h2>
                  <Badge status="Warranty Expiring" />
                </div>
                {warrantyItems.length === 0 ? (
                  <div style={{ color: "#aaa", fontSize: 14, textAlign: "center", paddingTop: 20 }}>{t("目前沒有提醒 ✓")}</div>
                ) : <>{warrantyItems.slice(0, 5).map((item, idx) => (
                    <div key={idx} onClick={() => { if (item.customer) { setTab("customers"); setSelectedCustomer(item.customer); } }} style={{ background: "#fff8f0", border: "1px solid #ffe0b2", borderRadius: 12, padding: "12px 16px", marginBottom: 10, cursor: item.customer ? "pointer" : "default", transition: "all 0.15s" }}
                      onMouseEnter={e => { if (item.customer) { e.currentTarget.style.borderColor = "#ff9800"; e.currentTarget.style.background = "#fff3e0"; } }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = "#ffe0b2"; e.currentTarget.style.background = "#fff8f0"; }}>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{item.productName}</div>
                      <div style={{ fontSize: 12, color: "#666", marginTop: 3 }}>{item.customerName} · {item.invoiceNum}</div>
                      <div style={{ fontSize: 12, color: "#e65100", marginTop: 4, fontWeight: 600 }}>{t("保修到期")}：{item.warrantyEnd}（{t("剩餘")} {item.daysLeft} {t("天")}）</div>
                    </div>
                ))}
                {warrantyItems.length > 5 && (
                  <button onClick={() => setTab("warranty")} style={{ display: "block", margin: "8px auto 0", padding: "8px 20px", background: "#fff3e0", color: "#ff9800", border: "1px solid #ffe0b2", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 13 }}>
                    {t("查看全部保修記錄 →")}
                  </button>
                )}</>}
              </div>
            </div>
          </div>
        )}

        {/* INVENTORY */}
        {/* PRODUCTS (合并庫存) */}
        {tab === "products" && !selectedProduct && (
          <ProductsListView
            setSelectedProduct={setSelectedProduct}
            setEditingProduct={setEditingProduct}
            setNewProduct={setNewProduct}
            setNewProductOpen={setNewProductOpen}
            search={search}
            setSearch={setSearch}
          />
        )}

        {/* PRODUCT DETAIL */}
        {tab === "products" && selectedProduct && (
          <ProductsDetailView
            selectedProduct={selectedProduct}
            setSelectedProduct={setSelectedProduct}
            setEditingProduct={setEditingProduct}
          />
        )}

        {/* CUSTOMERS */}
        {tab === "customers" && !selectedCustomer && (
          <CustomersListView
            setSelectedCustomer={setSelectedCustomer}
            search={search} setSearch={setSearch}
            setShowAddCustomer={setShowAddCustomer}
            setMergeCandidatesOpen={setMergeCandidatesOpen}
            customerGroups={customerGroups}
            Badge={Badge}
          />
        )}

        {/* CUSTOMER PROFILE */}
        {tab === "customers" && selectedCustomer && (
          <CustomersDetailView
            selectedCustomer={selectedCustomer} setSelectedCustomer={setSelectedCustomer}
            customerGroups={customerGroups}
            openEditCustomer={openEditCustomer}
            setManualMergeQuery={setManualMergeQuery} setManualMergeOpen={setManualMergeOpen}
            handleDeleteCustomer={handleDeleteCustomer}
            setMergeHistoryOpen={setMergeHistoryOpen}
            handleMarkPaid={handleMarkPaid}
            openPrintChooser={openPrintChooser}
            Badge={Badge}
            fmtInvNum={fmtInvNum}
            formatNotes={formatNotes}
          />
        )}

        {/* INVOICES */}
        {tab === "invoices" && (
          <InvoicesView
            search={search} setSearch={setSearch}
            customerGroups={customerGroups}
            getCustomer={getCustomer}
            fmtInvNum={fmtInvNum}
            formatNotes={formatNotes}
            invoiceSource={invoiceSource}
            getPossibleDupId={getPossibleDupId}
            handleMarkPaid={handleMarkPaid}
            openPrintChooser={openPrintChooser}
            handleUpgradePhysical={handleUpgradePhysical}
            Badge={Badge}
          />
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
          const bucketLabel = (b) => b === "expired" ? t("已過期") : b === "week" ? t("一週內") : b === "soon" ? t("30 天內") : b === "near" ? t("90 天內") : t("一年內");
          const filterBtns = [
            { k: "all", label: `${t("全部")} (${counts.all})`, color: "#555" },
            { k: "expired", label: `${t("已過期")} (${counts.expired})`, color: "#d14343" },
            { k: "week", label: `${t("一週內")} (${counts.week})`, color: "#ea580c" },
            { k: "soon", label: `${t("30 天內")} (${counts.soon})`, color: "#f59e0b" },
            { k: "near", label: `${t("90 天內")} (${counts.near})`, color: "#6382ff" },
            { k: "far", label: `${t("一年內")} (${counts.far})`, color: "#22c55e" },
          ];
          return (
            <div>
              <div style={{ marginBottom: 24 }}>
                <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>{t("保修")}</h1>
                <p style={{ color: "#888", margin: "4px 0 0", fontSize: 14 }}>{t("共")} {counts.all} {t("件需跟進（過期 30 天內 + 未來 365 天內到期，僅顯示有聯繫方式的客戶）")}</p>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
                {filterBtns.map(b => (
                  <button key={b.k} onClick={() => { setWarrantyBucket(b.k); setVisibleWarranty(50); }} style={{ padding: "8px 16px", borderRadius: 20, border: warrantyBucket === b.k ? `2px solid ${b.color}` : "1px solid #e0e0e0", background: warrantyBucket === b.k ? b.color + "18" : "#fff", color: warrantyBucket === b.k ? b.color : "#555", fontSize: 13, fontWeight: warrantyBucket === b.k ? 700 : 500, cursor: "pointer" }}>{b.label}</button>
                ))}
              </div>
              <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #f0f0f0", padding: "10px 14px", marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
                <Icon name="search" size={15} />
                <input placeholder={t("搜尋客戶名 / 電話 / 產品 / 發票號...")} value={warrantySearch} onChange={e => { setWarrantySearch(e.target.value); setVisibleWarranty(50); }} style={{ border: "none", background: "none", outline: "none", fontSize: 14, width: "100%" }} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {filtered.length === 0 ? (
                  <div style={{ padding: 40, textAlign: "center", color: "#999" }}>{t("沒有符合條件的保修記錄")}</div>
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
                      <div style={{ fontSize: 13, color: "#666", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{w.productName} · {w.invoiceNum} · {t("購買")} {w.invoiceDate}</div>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 800, color: bucketColor(w.bucket) }}>{w.warrantyEnd}</div>
                      <div style={{ fontSize: 12, color: "#888" }}>{w.daysLeft < 0 ? `${t("已過")} ${-w.daysLeft} ${t("天")}` : `${t("剩餘")} ${w.daysLeft} ${t("天")}`}</div>
                    </div>
                  </div>
                ))}
                {visibleWarranty < filtered.length && (
                  <button onClick={() => setVisibleWarranty(v => v + 50)} style={{ display: "block", margin: "12px auto", padding: "10px 28px", background: "#f0f4ff", color: "#6382ff", border: "1px solid #e0e8ff", borderRadius: 10, cursor: "pointer", fontWeight: 700, fontSize: 14 }}>
                    {t("載入更多")}（{filtered.length - visibleWarranty} {t("項待載入")}）
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
          // 產品銷售聚合：走 line_item_aliases 映射歸到 product UUID（套裝按 qty multiplier 比例分配營收）
          // 之後 Top 10 / 餅圖 / 銷售趨勢表 共用這份數據
          const normN = (s) => (s || "").toLowerCase().trim();
          const trendAliasByName = new Map(lineItemAliases.map(a => [normN(a.alias_name), a]));
          const productByName = new Map(products.map(pp => [pp.name, pp]));
          const productSalesMap = new Map(); // product_id → {qty, revenue}
          for (const inv of inRange) {
            if (!Array.isArray(inv.items)) continue;
            for (const it of inv.items) {
              if (!it || !it.name) continue;
              const itemQty = Number(it.qty) || 0;
              if (itemQty <= 0) continue;
              const itemPrice = Number(it.price) || 0;
              const lineValue = itemPrice * itemQty;
              const alias = trendAliasByName.get(normN(it.name));
              let resolved = []; // [{product_id, qty, share}]
              if (alias && alias.skip !== true && Array.isArray(alias.products) && alias.products.length > 0) {
                const totalMult = alias.products.reduce((s, ap) => s + (Number(ap.qty) || 1), 0);
                for (const ap of alias.products) {
                  const m = Number(ap.qty) || 1;
                  resolved.push({ product_id: ap.product_id, qty: m * itemQty, share: m / totalMult });
                }
              } else if (!alias) {
                const directProd = productByName.get(it.name);
                if (directProd) resolved.push({ product_id: directProd.id, qty: itemQty, share: 1 });
              }
              for (const r of resolved) {
                const cur = productSalesMap.get(r.product_id) || { qty: 0, revenue: 0 };
                cur.qty += r.qty;
                cur.revenue += lineValue * r.share;
                productSalesMap.set(r.product_id, cur);
              }
            }
          }
          // 按產品名合併同名 UUID（products 表存在多條同名 product，名字 string 一致就合一條）
          // 不過濾 _archived（Honnmono 現役產品因老遷移殘留全標 _archived，過濾會清空主力數據）
          // 過濾 is_virtual=true（押金/手續費等虛擬條目）
          const namedSalesMap = new Map(); // name → {qty, revenue}
          for (const [pid, v] of productSalesMap) {
            const p = products.find(x => x.id === pid);
            if (!p) continue;
            if (p.is_virtual === true) continue;
            const name = p.name || `(${t("未命名")})`;
            const cur = namedSalesMap.get(name) || { qty: 0, revenue: 0 };
            cur.qty += v.qty;
            cur.revenue += v.revenue;
            namedSalesMap.set(name, cur);
          }
          // 派生 prodMap (name→revenue) 給 Top 10 / 餅圖用
          const prodMap = {};
          for (const [name, v] of namedSalesMap) prodMap[name] = v.revenue;
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
                name: names.length > 0 ? names.join(" / ") : t("(無名客戶)"),
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
            { k: "thisMonth", label: t("本月") },
            { k: "lastMonth", label: t("上月") },
            { k: "3m", label: t("近 3 月") },
            { k: "12m", label: t("近 12 月") },
            { k: "year", label: t("本年度") },
            { k: "all", label: t("全部") },
          ];
          return (
            <div>
              <div style={{ marginBottom: 20 }}>
                <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>{t("營收")}</h1>
                <p style={{ color: "#888", margin: "4px 0 0", fontSize: 14 }}>{t("僅統計已付款（Paid）發票")}</p>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
                {ranges.map(r => (
                  <button key={r.k} onClick={() => setRevenueRange(r.k)} style={{ padding: "8px 16px", borderRadius: 20, border: revenueRange === r.k ? "2px solid #6382ff" : "1px solid #e0e0e0", background: revenueRange === r.k ? "#eef2ff" : "#fff", color: revenueRange === r.k ? "#6382ff" : "#555", fontSize: 13, fontWeight: revenueRange === r.k ? 700 : 500, cursor: "pointer" }}>{r.label}</button>
                ))}
              </div>
              {/* KPI cards */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 20 }}>
                <div style={{ background: "#fff", borderRadius: 14, padding: "20px 24px", border: "1px solid #f0f0f0" }}>
                  <div style={{ fontSize: 12, color: "#888", fontWeight: 600, letterSpacing: "0.04em" }}>{t("總營收")}</div>
                  <div style={{ fontSize: 26, fontWeight: 800, color: "#6382ff", marginTop: 4 }}>HKD${Math.round(totalRevenue).toLocaleString()}</div>
                </div>
                <div style={{ background: "#fff", borderRadius: 14, padding: "20px 24px", border: "1px solid #f0f0f0" }}>
                  <div style={{ fontSize: 12, color: "#888", fontWeight: 600, letterSpacing: "0.04em" }}>{t("已付發票數")}</div>
                  <div style={{ fontSize: 26, fontWeight: 800, color: "#22c55e", marginTop: 4 }}>{invCount}</div>
                </div>
                <div style={{ background: "#fff", borderRadius: 14, padding: "20px 24px", border: "1px solid #f0f0f0" }}>
                  <div style={{ fontSize: 12, color: "#888", fontWeight: 600, letterSpacing: "0.04em" }}>{t("平均單據")}</div>
                  <div style={{ fontSize: 26, fontWeight: 800, color: "#f59e0b", marginTop: 4 }}>HKD${avgValue.toLocaleString()}</div>
                </div>
                <div style={{ background: "#fff", borderRadius: 14, padding: "20px 24px", border: "1px solid #f0f0f0" }}>
                  <div style={{ fontSize: 12, color: "#888", fontWeight: 600, letterSpacing: "0.04em" }}>{t("未付款")}</div>
                  <div style={{ fontSize: 26, fontWeight: 800, color: "#d14343", marginTop: 4 }}>{unpaidCount}</div>
                  <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>HKD${unpaidAmount.toLocaleString()}</div>
                </div>
              </div>
              {/* 月度柱状图（多月份）/ 產品佔比餅圖（單月） */}
              {monthKeys.length > 1 ? (
                <div style={{ background: "#fff", borderRadius: 14, padding: 24, border: "1px solid #f0f0f0", marginBottom: 20 }}>
                  <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 700 }}>{t("月度營收趨勢")}</h3>
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
                  ...(restSum > 0 ? [{ name: t("其他"), value: restSum }] : []),
                ];
                const pieTotal = pieData.reduce((s, d) => s + d.value, 0);
                const colors = ["#6382ff", "#a78bfa", "#f59e0b", "#22c55e", "#ef4444", "#ea580c", "#14b8a6"];
                if (pieTotal === 0) return null;
                let offset = -Math.PI / 2;
                return (
                  <div style={{ background: "#fff", borderRadius: 14, padding: 24, border: "1px solid #f0f0f0", marginBottom: 20 }}>
                    <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 700 }}>{t("產品銷售佔比")}</h3>
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
                  <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 700 }}>{t("熱銷產品 Top 10")}</h3>
                  {prodTop.length === 0 ? <div style={{ color: "#aaa", fontSize: 13 }}>{t("沒有數據")}</div> : prodTop.map(([name, amt]) => (
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
                  <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 700 }}>{t("大客戶 Top 10")}</h3>
                  {custTop.length === 0 ? <div style={{ color: "#aaa", fontSize: 13 }}>{t("沒有數據")}</div> : custTop.map((c, idx) => (
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
              {/* 銷售佣金月結（admin only）— 跨銷售人按月聚合，含已扣回標識 */}
              {isBfAdmin && (() => {
                const commInvoices = invoices.filter(i => i.salesperson_id && Number(i.commission_amount || 0) > 0);
                if (commInvoices.length === 0) return null;
                // 月份 → salesperson → {earned, reversed, count}
                const monthlyMap = new Map();
                for (const inv of commInvoices) {
                  const ym = (inv.date || '').slice(0, 7);
                  if (!ym) continue;
                  if (!monthlyMap.has(ym)) monthlyMap.set(ym, new Map());
                  const spMap = monthlyMap.get(ym);
                  const sid = inv.salesperson_id;
                  if (!spMap.has(sid)) spMap.set(sid, { earned: 0, reversed: 0, count: 0 });
                  const cur = spMap.get(sid);
                  const amt = Number(inv.commission_amount || 0);
                  if (inv.commission_reversed) cur.reversed += amt;
                  else cur.earned += amt;
                  cur.count += 1;
                }
                const sortedYms = [...monthlyMap.keys()].sort().reverse();
                return (
                  <div style={{ background: "#fff", borderRadius: 14, padding: 24, border: "1px solid #f0f0f0", marginTop: 16 }}>
                    <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 700 }}>{t("銷售佣金月結")}</h3>
                    {sortedYms.map(ym => {
                      const spMap = monthlyMap.get(ym);
                      const monthEarned = [...spMap.values()].reduce((s, v) => s + v.earned, 0);
                      return (
                        <div key={ym} style={{ marginBottom: 14, border: "1px solid #f0f0f0", borderRadius: 10 }}>
                          <div style={{ padding: "10px 14px", borderBottom: "1px solid #f0f0f0", display: "flex", justifyContent: "space-between", alignItems: "center", background: "#fafbff" }}>
                            <div style={{ fontWeight: 700, fontSize: 14 }}>{ym}</div>
                            <div style={{ fontSize: 12, color: "#16a34a", fontWeight: 700 }}>HK$ {Math.round(monthEarned).toLocaleString()}</div>
                          </div>
                          {[...spMap.entries()].map(([sid, v]) => {
                            const sp = employees.find(e => e.id === sid);
                            return (
                              <div key={sid} style={{ display: "grid", gridTemplateColumns: "1fr 60px 110px 110px", gap: 10, padding: "8px 14px", borderTop: "1px solid #f8f8f8", alignItems: "center", fontSize: 12 }}>
                                <div style={{ fontWeight: 600 }}>{sp?.name || t("(已刪除)")}</div>
                                <div style={{ textAlign: "right", color: "#888" }}>{v.count} {t("張")}</div>
                                <div style={{ textAlign: "right", fontWeight: 700, color: "#16a34a" }}>HK$ {Math.round(v.earned).toLocaleString()}</div>
                                <div style={{ textAlign: "right", color: v.reversed > 0 ? "#b45309" : "#aaa" }}>
                                  {v.reversed > 0 ? `${t("扣回")} HK${Math.round(v.reversed).toLocaleString()}` : "—"}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          );
        })()}

        {/* EXPENSE — 報銷（lazy load，切過去才下載這個 chunk） */}
        {tab === "expense" && (
          <Suspense fallback={<div style={{ padding: 40, textAlign: "center", color: "#999" }}>{t("載入報銷模組…")}</div>}>
            <ExpenseView
              supabase={supabase}
              session={session}
              currentEmployee={currentEmployee}
              employees={employees}
              isAdmin={isBfAdmin}
            />
          </Suspense>
        )}

        {/* SUPPLIERS — 供應商管理 */}
        {tab === "suppliers" && (() => {
          const cats = Array.from(new Set(suppliers.map(s => s.category).filter(Boolean))).sort();
          const q = supplierSearch.trim().toLowerCase();
          const filtered = suppliers.filter(s => {
            if (supplierCategoryFilter !== "all" && (s.category || "") !== supplierCategoryFilter) return false;
            if (q) {
              const hit = (s.name || "").toLowerCase().includes(q)
                || (s.contact_person || "").toLowerCase().includes(q)
                || (s.category || "").toLowerCase().includes(q)
                || (s.note || "").toLowerCase().includes(q);
              if (!hit) return false;
            }
            return true;
          });
          return (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
                <div>
                  <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>{t("供應商")}</h1>
                  <p style={{ color: "#888", margin: "4px 0 0", fontSize: 14 }}>{t("共")} {filtered.length} {t("家供應商")}</p>
                </div>
                <button onClick={() => setShowAddSupplier(true)} style={{ display: "flex", alignItems: "center", gap: 8, background: "#6382ff", color: "#fff", border: "none", borderRadius: 10, padding: "10px 18px", cursor: "pointer", fontWeight: 700, fontSize: 14 }}>
                  <Icon name="plus" size={16} /> {t("新增供應商")}
                </button>
              </div>

              <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #f0f0f0", padding: "10px 14px", marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
                <Icon name="search" size={15} />
                <input placeholder={t("搜尋供應商...")} value={supplierSearch} onChange={e => setSupplierSearch(e.target.value)} style={{ border: "none", background: "none", outline: "none", fontSize: 14, width: "100%" }} />
              </div>

              {cats.length > 0 && (
                <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
                  <span style={{ fontSize: 13, color: "#888", marginRight: 4 }}>{t("分類")}：</span>
                  <button onClick={() => setSupplierCategoryFilter("all")} style={{ padding: "6px 14px", borderRadius: 20, border: supplierCategoryFilter === "all" ? "1px solid #6382ff" : "1px solid #e0e0e0", background: supplierCategoryFilter === "all" ? "#f0f4ff" : "#fff", color: supplierCategoryFilter === "all" ? "#6382ff" : "#666", fontSize: 13, fontWeight: 600, lineHeight: "20px", cursor: "pointer" }}>{t("全部")}</button>
                  {cats.map(c => (
                    <button key={c} onClick={() => setSupplierCategoryFilter(c)} style={{ padding: "6px 14px", borderRadius: 20, border: supplierCategoryFilter === c ? "1px solid #6382ff" : "1px solid #e0e0e0", background: supplierCategoryFilter === c ? "#f0f4ff" : "#fff", color: supplierCategoryFilter === c ? "#6382ff" : "#666", fontSize: 13, fontWeight: 600, lineHeight: "20px", cursor: "pointer" }}>{c}</button>
                  ))}
                </div>
              )}

              {filtered.length === 0 ? (
                <div style={{ background: "#fff", border: "1px dashed #e0e0e0", borderRadius: 12, padding: 60, textAlign: "center", color: "#aaa" }}>
                  {suppliers.length === 0 ? t("尚無供應商，點右上「新增供應商」開始") : t("沒有匹配結果")}
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 12 }}>
                  {filtered.map(s => (
                    <div key={s.id} style={{ background: "#fff", border: "1px solid #f0f0f0", borderRadius: 12, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 6 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                        <div style={{ fontSize: 15, fontWeight: 700, color: "#222" }}>{s.name}</div>
                        {s.category && <span style={{ fontSize: 11, color: "#6382ff", background: "#eef2ff", padding: "2px 8px", borderRadius: 6, fontWeight: 700 }}>{s.category}</span>}
                      </div>
                      {s.contact_person && <div style={{ fontSize: 12, color: "#666" }}>👤 {s.contact_person}</div>}
                      {s.contact_url && (
                        <a href={s.contact_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: "#3b58d4", textDecoration: "none", padding: "6px 10px", background: "#eef2ff", borderRadius: 6, display: "inline-flex", alignItems: "center", gap: 4, alignSelf: "flex-start", fontWeight: 600 }}>
                          🔗 {t("打開聯繫")}
                        </a>
                      )}
                      {s.note && <div style={{ fontSize: 12, color: "#888", marginTop: 2, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{s.note}</div>}
                      <div style={{ display: "flex", gap: 8, marginTop: "auto", paddingTop: 6, borderTop: "1px dashed #f0f0f0" }}>
                        <button onClick={() => setEditingSupplier({ ...s })} style={{ flex: 1, padding: "5px 10px", background: "#f5f5f5", color: "#666", border: "none", borderRadius: 6, fontSize: 11, cursor: "pointer", fontWeight: 600 }}>✏ {t("編輯")}</button>
                        <button onClick={() => handleDeleteSupplier(s.id)} style={{ padding: "5px 10px", background: "#fce4ec", color: "#e53935", border: "none", borderRadius: 6, fontSize: 11, cursor: "pointer", fontWeight: 600 }}>🗑</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })()}

        {tab === "whatsapp" && (() => {
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
          // 敏感字段編輯密碼門檻
          const ensureUnlocked = () => {
            if (waSecretUnlocked) return true;
            if (!isWaAdmin) { alert(t("您是只讀帳戶，無法解鎖查看 / 編輯敏感字段（API Key / Boss Prompt 等）。")); return false; }
            if (!s.admin_password) {
              const pwd = window.prompt(t("首次設置管理員密碼（用於保護 API Key / Boss Prompt / Model / Base URL 編輯）："));
              if (!pwd || !pwd.trim()) return false;
              saveSettings({ admin_password: pwd.trim() });
              setWaSecretUnlocked(true);
              return true;
            }
            const pwd = window.prompt(t("請輸入管理員密碼："));
            if (pwd === s.admin_password) { setWaSecretUnlocked(true); return true; }
            alert(t("密碼錯誤"));
            return false;
          };
          const kindLabel = { phone: t("私聊白名單（手機）"), group: t("群聊白名單（精確）"), group_fuzzy: t("群聊白名單（模糊）"), staff: t("客服名單（手機）") };
          const customersMap = new Map();
          for (const m of waMessages) {
            if (!customersMap.has(m.customer_id)) customersMap.set(m.customer_id, []);
            customersMap.get(m.customer_id).push(m);
          }
          const customerIds = [...customersMap.keys()].sort((a, b) => {
            const la = customersMap.get(a);
            const lb = customersMap.get(b);
            return new Date(lb[0]?.created_at || 0) - new Date(la[0]?.created_at || 0);
          });

          return (
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
                    {" · "}{t("共")} {customerIds.length} {t("位客戶")} · {waMessages.length} {t("條消息")} · {waUnresolved.filter(u => !u.resolved_at).length} {t("條未解決")}
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
                    <Input label="API Key" value={waSecretUnlocked ? (s.openai_api_key || "") : (s.openai_api_key ? "•".repeat(Math.min(s.openai_api_key.length, 40)) : "")} onChange={v => setWaSettings({ ...s, openai_api_key: v })} placeholder="sk-..." readOnly={!waSecretUnlocked} />
                    <Input label="Model" value={s.model || ""} onChange={v => setWaSettings({ ...s, model: v })} placeholder="gpt-4o" readOnly={!waSecretUnlocked} />
                    <div style={{ display: "flex", gap: 10 }}>
                      <button disabled={!waSecretUnlocked} onClick={() => saveSettings({ openai_base_url: s.openai_base_url, openai_api_key: s.openai_api_key, model: s.model })} style={{ padding: "9px 18px", background: waSecretUnlocked ? "#6382ff" : "#e0e0e0", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: waSecretUnlocked ? "pointer" : "not-allowed" }}>{t("儲存 API 配置")}</button>
                      <button disabled={!s.openai_base_url || !s.openai_api_key || !s.model} onClick={async () => {
                        try {
                          const r = await fetch(s.openai_base_url.replace(/\/+$/, '') + '/chat/completions', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + s.openai_api_key },
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
                      }} style={{ padding: "9px 18px", background: (!s.openai_base_url || !s.openai_api_key || !s.model) ? "#e0e0e0" : "#22c55e", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: (s.openai_base_url && s.openai_api_key && s.model) ? "pointer" : "not-allowed" }}>{t("測試連接")}</button>
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
                <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 14, minHeight: "60vh" }}>
                  <div style={{ background: "#fff", border: "1px solid #f0f0f0", borderRadius: 12, overflow: "hidden", display: "flex", flexDirection: "column" }}>
                    <div style={{ padding: "12px 14px", borderBottom: "1px solid #f0f0f0", fontSize: 13, fontWeight: 700 }}>{t("客戶")} <span style={{ color: "#aaa", marginLeft: 4 }}>{customerIds.length}</span></div>
                    <div style={{ flex: 1, overflowY: "auto" }}>
                      {customerIds.length === 0 ? <div style={{ padding: 16, fontSize: 12, color: "#aaa", fontStyle: "italic" }}>{t("尚無對話")}</div>
                      : customerIds.map(cid => {
                        const msgs = customersMap.get(cid);
                        const active = waSelectedCustomer === cid;
                        return (
                          <div key={cid} onClick={() => setWaSelectedCustomer(cid)} style={{ padding: "10px 14px", borderBottom: "1px solid #f5f5f5", cursor: "pointer", background: active ? "#eef2ff" : "transparent" }}>
                            <div style={{ fontSize: 12, fontWeight: 700, color: active ? "#3b58d4" : "#333", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cid}</div>
                            <div style={{ fontSize: 11, color: "#999", marginTop: 2 }}>{msgs.length} {t("條")} · {msgs[0]?.created_at?.slice(5, 16).replace("T", " ") || ""}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div style={{ background: "#fff", border: "1px solid #f0f0f0", borderRadius: 12, padding: 16, overflowY: "auto", maxHeight: "70vh" }}>
                    {!waSelectedCustomer ? <div style={{ color: "#aaa", fontSize: 13, textAlign: "center", paddingTop: 80 }}>{t("← 從左側選擇客戶查看對話")}</div>
                    : (() => {
                      const msgs = [...(customersMap.get(waSelectedCustomer) || [])].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
                      return (
                        <>
                          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, paddingBottom: 10, borderBottom: "1px solid #f0f0f0" }}>{waSelectedCustomer} · {msgs.length} {t("條")}</div>
                          {msgs.map(m => (
                            <div key={m.id} style={{ marginBottom: 12, display: "flex", justifyContent: m.role === "assistant" ? "flex-start" : "flex-end" }}>
                              <div style={{ maxWidth: "75%", background: m.role === "assistant" ? "#f0f4ff" : "#e8f5e9", borderRadius: 10, padding: "8px 12px", fontSize: 13, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
                                {m.content}
                                <div style={{ fontSize: 10, color: "#999", marginTop: 4 }}>{new Date(m.created_at).toLocaleString("zh-HK", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</div>
                              </div>
                            </div>
                          ))}
                        </>
                      );
                    })()}
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
                      return (
                        <div key={r.id} style={{ background: "#fff", border: "1px solid #fce4ec", borderRadius: 10, padding: "12px 16px", marginBottom: 8, display: "flex", gap: 12, alignItems: "flex-start" }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, color: "#222", wordBreak: "break-word" }}>{preview || t("（無內容）")}</div>
                            <div style={{ fontSize: 11, color: "#888", marginTop: 4, display: "flex", gap: 10, flexWrap: "wrap" }}>
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
                  // 待處理 — 紅淺
                  "未解决":   { bg: "#fff0f0", color: "#a32424" },
                  // 圖片 — 中性
                  "图片":     { bg: "#f5f5f5", color: "#555" },
                };
                return (
                  <div>
                    <div style={{ fontSize: 13, color: "#888", marginBottom: 10 }}>
                      {t("共")} {waLogs.length} {t("條")} · {t("雲端保留 24 小時 · 5s 自動刷新")}
                      <span style={{ marginLeft: 10, color: "#aaa", fontSize: 12 }}>
                        {t("（收到/回復入隊/未解決的客戶原話自動脫敏）")}
                      </span>
                    </div>
                    {waLogs.length === 0 ? (
                      <div style={{ background: "#fff", borderRadius: 10, padding: 40, textAlign: "center", color: "#aaa", border: "1px dashed #e0e0e0" }}>
                        {t("暫無日誌（等 server.js 重啟後或下次同步出問題時會自動填）")}
                      </div>
                    ) : (
                      <div style={{ background: "#fff", border: "1px solid #f0f0f0", borderRadius: 10, padding: 12, maxHeight: "70vh", overflowY: "auto", fontFamily: "Consolas, Menlo, monospace", fontSize: 12, lineHeight: 1.7 }}>
                        {waLogs.map(r => {
                          const c = catColor[r.category] || { bg: "#f5f5f5", color: "#666" };
                          const ts = new Date(r.created_at).toLocaleString(lang === "en" ? "en-HK" : lang === "fr" ? "fr-FR" : "zh-HK", { hour12: false });
                          return (
                            <div key={r.id} style={{ display: "flex", gap: 10, padding: "4px 0", borderBottom: "1px solid #fafafa" }}>
                              <span style={{ color: "#999", flexShrink: 0, width: 140 }}>{ts}</span>
                              <span style={{ background: c.bg, color: c.color, padding: "1px 8px", borderRadius: 4, fontSize: 11, fontWeight: 700, flexShrink: 0, alignSelf: "center", minWidth: 60, textAlign: "center" }}>{t(r.category)}</span>
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
          );
        })()}

        {/* UPDATE LOG — 從員工管理 logs sub-tab 抽出來的獨立頂級板塊（沿用 employee_update_logs 表 + 同款 UI） */}
        {tab === "updatelog" && (() => {
          const helenEmp = employees.find(e => MARKDOWN_LOG_AUTHORS.has(e.id)) || employees.find(e => e.show_update_log === true);
          if (!helenEmp) {
            return <div style={{ background: "#fff", border: "1px dashed #e0e0e0", borderRadius: 12, padding: 60, textAlign: "center", color: "#aaa" }}>{t("未配置 show_update_log 員工")}</div>;
          }
          const canEditHelen = isBfAdmin || (currentEmployee && currentEmployee.id === helenEmp.id);
          const allMyLogs = updateLogs.filter(l => l.employee_id === helenEmp.id);
          const myLogs = allMyLogs.slice(0, logsVisibleCount);
          const hasMore = allMyLogs.length > myLogs.length;
          const fmtFull = (iso) => {
            const d = new Date(iso);
            const yyyy = d.getFullYear();
            const mm = String(d.getMonth() + 1).padStart(2, "0");
            const dd = String(d.getDate()).padStart(2, "0");
            let h = d.getHours();
            const min = String(d.getMinutes()).padStart(2, "0");
            const ampm = h >= 12 ? "PM" : "AM";
            h = h % 12; if (h === 0) h = 12;
            return `${yyyy}/${mm}/${dd} ${String(h).padStart(2, "0")}:${min} ${ampm}`;
          };
          const renderCommentTree = (logId, parentId, depth) => {
            const list = logComments.filter(c => c.update_log_id === logId && (c.parent_comment_id || null) === parentId);
            return list.map(c => {
              const isOwn = c.author_user_id === userId;
              const canEditCmt = isOwn || isBfAdmin;
              const isEditing = editingLogComment && editingLogComment.id === c.id;
              const isReplyingHere = replyingToLogComment && replyingToLogComment.parentId === c.id;
              return (
                <div key={c.id} style={{ marginLeft: depth * 20, marginTop: 8, paddingLeft: depth > 0 ? 10 : 0, borderLeft: depth > 0 ? "2px solid #eef2ff" : "none" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
                    <div style={{ fontSize: 11, color: "#888" }}>
                      <strong style={{ color: "#3b58d4" }}>{c.author_name || t("未知")}</strong>
                      <span style={{ marginLeft: 6 }}>{new Date(c.created_at).toLocaleString("zh-HK", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                      {c.updated_at && c.updated_at !== c.created_at && <span style={{ marginLeft: 4, color: "#bbb" }}>·{t("已編輯")}</span>}
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button onClick={() => setReplyingToLogComment(isReplyingHere ? null : { logId, parentId: c.id })} style={{ background: "none", border: "none", color: "#6382ff", fontSize: 11, cursor: "pointer", padding: 0 }}>{isReplyingHere ? t("取消") : `↩ ${t("回復")}`}</button>
                      {canEditCmt && !isEditing && <button onClick={() => setEditingLogComment({ id: c.id, body: c.body })} style={{ background: "none", border: "none", color: "#888", fontSize: 11, cursor: "pointer", padding: 0 }}>✏</button>}
                      {canEditCmt && <button onClick={() => handleDeleteLogComment(c.id)} style={{ background: "none", border: "none", color: "#e53935", fontSize: 11, cursor: "pointer", padding: 0 }}>×</button>}
                    </div>
                  </div>
                  {isEditing ? (
                    <div>
                      <textarea value={editingLogComment.body} onChange={e => setEditingLogComment({ ...editingLogComment, body: e.target.value })} style={{ width: "100%", minHeight: 50, padding: "6px 8px", borderRadius: 6, border: "1px solid #6382ff", fontSize: 12, fontFamily: "inherit", outline: "none", boxSizing: "border-box", resize: "vertical" }} />
                      <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                        <button onClick={async () => { await handleUpdateLogComment(c.id, editingLogComment.body); setEditingLogComment(null); }} style={{ padding: "4px 10px", background: "#6382ff", color: "#fff", border: "none", borderRadius: 6, fontSize: 11, cursor: "pointer" }}>{t("保存")}</button>
                        <button onClick={() => setEditingLogComment(null)} style={{ padding: "4px 10px", background: "#fff", color: "#888", border: "1px solid #e0e0e0", borderRadius: 6, fontSize: 11, cursor: "pointer" }}>{t("取消")}</button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ fontSize: 12, color: "#333", lineHeight: 1.5, whiteSpace: MARKDOWN_COMMENT_AUTHORS.has(c.author_user_id) ? "normal" : "pre-wrap" }}>
                      {MARKDOWN_COMMENT_AUTHORS.has(c.author_user_id) ? <MarkdownText text={c.body} fontSize={12} /> : c.body}
                    </div>
                  )}
                  {isReplyingHere && (
                    <div style={{ marginTop: 6 }}>
                      <textarea
                        value={newLogCommentDraft[`reply:${logId}:${c.id}`] || ""}
                        onChange={e => setNewLogCommentDraft({ ...newLogCommentDraft, [`reply:${logId}:${c.id}`]: e.target.value })}
                        placeholder={t("回復")}
                        style={{ width: "100%", minHeight: 40, padding: "6px 8px", borderRadius: 6, border: "1px solid #6382ff", fontSize: 12, fontFamily: "inherit", outline: "none", boxSizing: "border-box", resize: "vertical" }}
                      />
                      <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                        <button onClick={async () => { const k = `reply:${logId}:${c.id}`; await handleAddLogComment(logId, newLogCommentDraft[k] || "", c.id); setNewLogCommentDraft({ ...newLogCommentDraft, [k]: "" }); setReplyingToLogComment(null); }} style={{ padding: "4px 10px", background: "#6382ff", color: "#fff", border: "none", borderRadius: 6, fontSize: 11, cursor: "pointer" }}>{t("發送")}</button>
                      </div>
                    </div>
                  )}
                  {renderCommentTree(logId, c.id, depth + 1)}
                </div>
              );
            });
          };
          return (
            <div>
              <h1 style={{ fontSize: 24, marginBottom: 20 }}>{t("更新日誌")}</h1>
              {/* 新增更新區（僅本人，admin 在別人頁面也不能寫） */}
              {currentEmployee && helenEmp.id === currentEmployee.id && (
                <div style={{ background: "#fafbff", border: "1px solid #eef0fa", borderRadius: 12, padding: 16, marginBottom: 20 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#3b58d4", marginBottom: 10 }}>＋ {t("新增更新")}</div>
                  <div style={{ fontSize: 11, color: "#888", marginBottom: 4 }}>{t("簡略（必填）")}</div>
                  <textarea value={newLogDraft.summary} onChange={e => setNewLogDraft({ ...newLogDraft, summary: e.target.value })} placeholder={t("一句話概括今天做了什麼...")} rows={2} style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #e0e0e0", fontSize: 13, outline: "none", marginBottom: 10, boxSizing: "border-box", resize: "vertical", fontFamily: "inherit" }} />
                  <div style={{ fontSize: 11, color: "#888", marginBottom: 4 }}>{t("詳細（可選，展開後顯示）")}</div>
                  <textarea value={newLogDraft.detail} onChange={e => setNewLogDraft({ ...newLogDraft, detail: e.target.value })} placeholder={t("詳細描述...")} style={{ width: "100%", minHeight: 100, padding: "8px 10px", borderRadius: 8, border: "1px solid #e0e0e0", fontSize: 12, outline: "none", resize: "vertical", boxSizing: "border-box", fontFamily: "inherit", marginBottom: 10 }} />
                  <button onClick={async () => { if (!newLogDraft.summary.trim()) return; await handleAddUpdateLog(helenEmp.id, newLogDraft.summary, newLogDraft.detail); setNewLogDraft({ summary: "", detail: "" }); }} disabled={!newLogDraft.summary.trim()} style={{ padding: "8px 18px", background: newLogDraft.summary.trim() ? "#6382ff" : "#e0e0e0", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: newLogDraft.summary.trim() ? "pointer" : "not-allowed" }}>{t("保存")}</button>
                </div>
              )}
              {/* 時間軸 */}
              {allMyLogs.length === 0 ? (
                <div style={{ background: "#fff", border: "1px dashed #e0e0e0", borderRadius: 12, padding: 60, textAlign: "center", color: "#aaa", fontSize: 13 }}>{t("暫無更新記錄")}</div>
              ) : (<>
                <div style={{ position: "relative", paddingLeft: 24 }}>
                  <div style={{ position: "absolute", left: 7, top: 6, bottom: 6, width: 2, background: "#eef2ff" }} />
                  {myLogs.map(log => {
                    const isExpanded = expandedLogIds.has(log.id);
                    const isEditingThis = editingLogId === log.id;
                    const cmtCount = logComments.filter(c => c.update_log_id === log.id).length;
                    const isReplyingTopHere = replyingToLogComment && replyingToLogComment.logId === log.id && replyingToLogComment.parentId === null;
                    return (
                      <div key={log.id} style={{ position: "relative", marginBottom: 18 }}>
                        <div style={{ position: "absolute", left: -22, top: 8, width: 12, height: 12, borderRadius: "50%", background: "#6382ff", border: "2px solid #fff", boxShadow: "0 0 0 2px #6382ff" }} />
                        <div style={{ background: "#fff", border: "1px solid #eef0fa", borderRadius: 10, padding: "12px 14px" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                            <div style={{ fontSize: 11, color: "#888", fontWeight: 600 }}>{fmtFull(log.created_at)}{log.updated_at && log.updated_at !== log.created_at && <span style={{ marginLeft: 6, color: "#bbb", fontWeight: 400 }}>·{t("已編輯")} {fmtFull(log.updated_at)}</span>}</div>
                            {canEditHelen && !isEditingThis && (
                              <div style={{ display: "flex", gap: 6 }}>
                                <button onClick={() => { setEditingLogId(log.id); setEditingLogDraft({ summary: log.summary || "", detail: log.detail || "" }); }} style={{ background: "none", border: "none", color: "#888", fontSize: 12, cursor: "pointer", padding: 0 }}>✏ {t("編輯")}</button>
                                <button onClick={() => handleDeleteUpdateLog(log.id)} style={{ background: "none", border: "none", color: "#e53935", fontSize: 12, cursor: "pointer", padding: 0 }}>× {t("刪除")}</button>
                              </div>
                            )}
                          </div>
                          {isEditingThis ? (
                            <div>
                              <textarea value={editingLogDraft.summary} onChange={e => setEditingLogDraft({ ...editingLogDraft, summary: e.target.value })} placeholder={t("簡略")} rows={2} style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid #6382ff", fontSize: 13, outline: "none", marginBottom: 8, boxSizing: "border-box", resize: "vertical", fontFamily: "inherit" }} />
                              <textarea value={editingLogDraft.detail} onChange={e => setEditingLogDraft({ ...editingLogDraft, detail: e.target.value })} placeholder={t("詳細")} style={{ width: "100%", minHeight: 100, padding: "8px 10px", borderRadius: 6, border: "1px solid #6382ff", fontSize: 12, outline: "none", resize: "vertical", boxSizing: "border-box", fontFamily: "inherit", marginBottom: 8 }} />
                              <div style={{ display: "flex", gap: 6 }}>
                                <button onClick={async () => { if (!editingLogDraft.summary.trim()) return; await handleUpdateUpdateLog(log.id, { summary: editingLogDraft.summary.trim(), detail: editingLogDraft.detail.trim() || null }); setEditingLogId(null); }} style={{ padding: "5px 12px", background: "#6382ff", color: "#fff", border: "none", borderRadius: 6, fontSize: 12, cursor: "pointer" }}>{t("保存")}</button>
                                <button onClick={() => setEditingLogId(null)} style={{ padding: "5px 12px", background: "#fff", color: "#888", border: "1px solid #e0e0e0", borderRadius: 6, fontSize: 12, cursor: "pointer" }}>{t("取消")}</button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div onClick={() => { setExpandedLogIds(prev => { const n = new Set(prev); if (n.has(log.id)) n.delete(log.id); else n.add(log.id); return n; }); }} style={{ fontSize: 14, color: "#222", lineHeight: 1.5, cursor: "pointer", display: "flex", alignItems: "flex-start", gap: 8 }}>
                                <span style={{ color: "#6382ff", fontSize: 11, marginTop: 3 }}>{isExpanded ? "▼" : "▶"}</span>
                                <span style={{ flex: 1, whiteSpace: MARKDOWN_LOG_AUTHORS.has(log.employee_id) ? "normal" : "pre-wrap" }}>
                                  {MARKDOWN_LOG_AUTHORS.has(log.employee_id) ? <MarkdownText text={log.summary} fontSize={14} /> : log.summary}
                                </span>
                              </div>
                              {isExpanded && log.detail && (
                                <div style={{ marginTop: 10, padding: "10px 12px", background: "#fafbff", borderRadius: 8, fontSize: 12, color: "#444", lineHeight: 1.6, whiteSpace: MARKDOWN_LOG_AUTHORS.has(log.employee_id) ? "normal" : "pre-wrap" }}>
                                  {MARKDOWN_LOG_AUTHORS.has(log.employee_id) ? <MarkdownText text={log.detail} fontSize={12} /> : log.detail}
                                </div>
                              )}
                            </>
                          )}
                          {/* 評論區 */}
                          <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px dashed #eef0fa" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <div style={{ fontSize: 11, color: "#888" }}>💬 {t("評論")} <span style={{ color: "#aaa" }}>{cmtCount}</span></div>
                              {!isReplyingTopHere && <button onClick={() => setReplyingToLogComment({ logId: log.id, parentId: null })} style={{ background: "none", border: "none", color: "#6382ff", fontSize: 11, cursor: "pointer", padding: 0 }}>+ {t("評論")}</button>}
                            </div>
                            {isReplyingTopHere && (
                              <div style={{ marginTop: 6 }}>
                                <textarea
                                  value={newLogCommentDraft[`reply:${log.id}:null`] || ""}
                                  onChange={e => setNewLogCommentDraft({ ...newLogCommentDraft, [`reply:${log.id}:null`]: e.target.value })}
                                  placeholder={t("發表評論...")}
                                  style={{ width: "100%", minHeight: 50, padding: "6px 8px", borderRadius: 6, border: "1px solid #6382ff", fontSize: 12, fontFamily: "inherit", outline: "none", boxSizing: "border-box", resize: "vertical" }}
                                />
                                <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                                  <button onClick={async () => { const k = `reply:${log.id}:null`; await handleAddLogComment(log.id, newLogCommentDraft[k] || ""); setNewLogCommentDraft({ ...newLogCommentDraft, [k]: "" }); setReplyingToLogComment(null); }} style={{ padding: "4px 10px", background: "#6382ff", color: "#fff", border: "none", borderRadius: 6, fontSize: 11, cursor: "pointer" }}>{t("發送")}</button>
                                  <button onClick={() => setReplyingToLogComment(null)} style={{ padding: "4px 10px", background: "#fff", color: "#888", border: "1px solid #e0e0e0", borderRadius: 6, fontSize: 11, cursor: "pointer" }}>{t("取消")}</button>
                                </div>
                              </div>
                            )}
                            <div>{renderCommentTree(log.id, null, 0)}</div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {hasMore && (
                  <div style={{ textAlign: "center", marginTop: 14 }}>
                    <button onClick={() => setLogsVisibleCount(c => c + 20)} style={{ padding: "8px 20px", background: "#fff", border: "1px solid #6382ff", color: "#6382ff", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                      {t("加載更多")}（{t("剩餘")} {allMyLogs.length - myLogs.length}）
                    </button>
                  </div>
                )}
              </>)}
            </div>
          );
        })()}

        {/* 帳號審核已移至 team 子應用：https://team.honnmono.top */}
      </main>

      {/* INSTALL TUTORIAL MODAL */}
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

      {/* PENDING MERGE PROMPT MODAL */}
      {pendingMerge && (() => {
        const { newCustomer: nc, oldCustomer: oc } = pendingMerge;
        const isEmpty = v => v == null || String(v).trim() === "";
        const rows = [
          [t("姓名"), "name"],
          [t("香港電話"), "phone"],
          [t("內地電話"), "phone_mainland"],
          [t("郵箱"), "email"],
          [t("地址"), "address"],
          [t("車品牌"), "car_make"],
          [t("車型"), "car_model"],
          [t("推薦人"), "referral"],
        ];
        return (
          <div onClick={() => !mergeBusy && setPendingMerge(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 2100, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
            <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: 28, width: 720, maxWidth: "100%", maxHeight: "90vh", overflowY: "auto", boxShadow: "0 10px 40px rgba(0,0,0,0.25)" }}>
              <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>🔔 {t("疑似重複客戶，是否合併？")}</div>
              <div style={{ fontSize: 13, color: "#666", marginBottom: 18, lineHeight: 1.6 }}>
                {t("此表單提交的新客戶匹配到原有客戶（姓名/電話/郵箱/地址命中 3 分以上）。")}<br/>
                {t("合併邏輯：")}<b>{t("原有資料不變")}</b>{t("，只將老客戶空的欄位填入新表單值。帶 🆕 的是新客戶獨有的資訊。")}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "100px 1fr 1fr 180px", gap: 0, border: "1px solid #eee", borderRadius: 10, overflow: "hidden", marginBottom: 18 }}>
                <div style={{ background: "#fafafa", padding: "10px 12px", fontSize: 12, fontWeight: 700, color: "#888" }}>{t("欄位")}</div>
                <div style={{ background: "#fafafa", padding: "10px 12px", fontSize: 12, fontWeight: 700, color: "#888", borderLeft: "1px solid #eee" }}>{t("原有客戶")}</div>
                <div style={{ background: "#fff9ec", padding: "10px 12px", fontSize: 12, fontWeight: 700, color: "#8a6900", borderLeft: "1px solid #eee" }}>{t("新表單客戶")}</div>
                <div style={{ background: "#fafafa", padding: "10px 12px", fontSize: 12, fontWeight: 700, color: "#888", borderLeft: "1px solid #eee", textAlign: "center" }}>{t("差異處理")}</div>
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
                        {isDiff && <span style={{ background: "#f8d7da", color: "#721c24", fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 4 }}>{t("差異")}</span>}
                      </div>
                      <div key={key+"-c"} style={{ padding: "6px 8px", borderLeft: "1px solid #eee", borderTop: "1px solid #eee", display: "flex", alignItems: "center", gap: 4 }}>
                        {isDiff ? (<>{btn("keep", t("保留"))}{btn("overwrite", t("覆蓋"))}{btn("append", t("追加"))}</>) : (<span style={{ flex: 1, textAlign: "center", color: "#bbb", fontSize: 11 }}>{isNew ? t("自動補") : "—"}</span>)}
                      </div>
                    </>
                  );
                })}
              </div>
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <button disabled={mergeBusy} onClick={() => setPendingMerge(null)} style={{ background: "#f5f5f5", border: "none", borderRadius: 8, padding: "10px 18px", fontWeight: 600, cursor: mergeBusy ? "not-allowed" : "pointer" }}>{t("關閉（下次再決定）")}</button>
                <button disabled={mergeBusy} onClick={handleConfirmMerge} style={{ background: mergeBusy ? "#ccc" : "#6382ff", color: "#fff", border: "none", borderRadius: 8, padding: "10px 18px", fontWeight: 700, cursor: mergeBusy ? "not-allowed" : "pointer" }}>
                  {mergeBusy ? t("合併中…") : t("合併到原客戶")}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* MERGE HISTORY MODAL — 点"已合并 N 条"徽标弹出 */}
      <MergeHistoryModal
        mergeHistoryOpen={mergeHistoryOpen}
        setMergeHistoryOpen={setMergeHistoryOpen}
        openRollback={openRollback}
        handleUpgradePhysical={handleUpgradePhysical}
        customerGroups={customerGroups}
      />

      {/* ROLLBACK MODAL — 從合併記錄 modal 點「回退」打開 */}
      <RollbackModal
        rollbackOpen={rollbackOpen} setRollbackOpen={setRollbackOpen}
        rollbackMergeToQuery={rollbackMergeToQuery} setRollbackMergeToQuery={setRollbackMergeToQuery}
        rollbackMergeTo={rollbackMergeTo} setRollbackMergeTo={setRollbackMergeTo}
        rollbackMergeToOpen={rollbackMergeToOpen} setRollbackMergeToOpen={setRollbackMergeToOpen}
        rollbackAffected={rollbackAffected} setRollbackAffected={setRollbackAffected}
        rollbackTarget={rollbackTarget} setRollbackTarget={setRollbackTarget}
        rollbackFields={rollbackFields} setRollbackFields={setRollbackFields}
        rollbackBusy={rollbackBusy}
        customerGroups={customerGroups}
        handleRollback={handleRollback}
      />

      {/* MERGE CANDIDATES MODAL — 客户页一键入口 */}
      <MergeCandidatesModal
        mergeCandidatesOpen={mergeCandidatesOpen}
        setMergeCandidatesOpen={setMergeCandidatesOpen}
        customerGroups={customerGroups}
        mergeAllBusy={mergeAllBusy}
        handleMergeAllPhysical={handleMergeAllPhysical}
        handleUpgradePhysical={handleUpgradePhysical}
        setSelectedCustomer={setSelectedCustomer}
      />

      {/* EDIT CUSTOMER MODAL */}
      <EditCustomerModal
        editingCustomer={editingCustomer} setEditingCustomer={setEditingCustomer}
        selectedCustomer={selectedCustomer}
        editCustForm={editCustForm} setEditCustForm={setEditCustForm}
        editCustSaving={editCustSaving}
        editCustCid={editCustCid}
        handleSaveCustomerEdit={handleSaveCustomerEdit}
      />

      {/* MANUAL MERGE MODAL — 把當前客戶合並到另一個客戶 */}
      {manualMergeOpen && selectedCustomer && (() => {
        const fromCids = selectedCustomer.allCids || selectedCustomer.groupCids || [selectedCustomer.id];
        const candidates = (customerGroups?.virtualCustomers || []).filter(vc => {
          if (fromCids.includes(vc.id)) return false;
          const inGroup = (vc.allCids || vc.groupCids || []);
          if (inGroup.some(id => fromCids.includes(id))) return false;
          const q = manualMergeQuery.trim().toLowerCase();
          if (!q) return false;
          return [vc.name, vc.email, vc.phone, vc.phone_mainland].some(v => (v || "").toLowerCase().includes(q));
        }).slice(0, 30);
        const doMerge = async (keeper) => {
          if (!confirm(`${t("確認把")}「${selectedCustomer.name || t("(無名)")}」${t("合併到")}「${keeper.name || t("(無名)")}」？\n${t("合併後當前客戶會變成 keeper 的子記錄，發票關聯不變。")}`)) return;
          const { error } = await supabase.from("customers").update({ parent_id: keeper.id }).in("id", fromCids);
          if (error) { alert(t("合併失敗") + "：" + error.message); return; }
          setCustomers(prev => prev.map(c => fromCids.includes(c.id) ? { ...c, parent_id: keeper.id } : c));
          setManualMergeOpen(false);
          setManualMergeQuery("");
          setSelectedCustomer(keeper);
        };
        return (
          <div onClick={() => setManualMergeOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2100, padding: 20 }}>
            <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, width: 540, maxWidth: "100%", maxHeight: "85vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
              <div style={{ padding: "20px 24px", borderBottom: "1px solid #f0f0f0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>{t("合併到其他客戶")}</h2>
                  <div style={{ fontSize: 12, color: "#888", marginTop: 4 }}>{t("把")}「{selectedCustomer.name || t("(無名)")}」{t("作為子記錄，掛到所選客戶下")}</div>
                </div>
                <button onClick={() => setManualMergeOpen(false)} style={{ background: "#f5f5f5", border: "none", borderRadius: 8, padding: "6px 10px", cursor: "pointer" }}><Icon name="x" size={16} /></button>
              </div>
              <div style={{ padding: 20 }}>
                <input
                  autoFocus
                  type="text"
                  value={manualMergeQuery}
                  onChange={e => setManualMergeQuery(e.target.value)}
                  placeholder={t("搜尋姓名 / 電話 / 郵箱")}
                  style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid #e0e0e0", fontSize: 14, outline: "none", boxSizing: "border-box" }}
                />
              </div>
              <div style={{ flex: 1, overflowY: "auto", padding: "0 16px 20px" }}>
                {!manualMergeQuery.trim() ? (
                  <div style={{ padding: 30, textAlign: "center", color: "#aaa", fontSize: 13 }}>{t("輸入關鍵字搜尋目標客戶")}</div>
                ) : candidates.length === 0 ? (
                  <div style={{ padding: 30, textAlign: "center", color: "#aaa", fontSize: 13 }}>{t("沒有符合的客戶")}</div>
                ) : (
                  candidates.map(vc => (
                    <div key={vc.id} onClick={() => doMerge(vc)} style={{ padding: "10px 12px", borderRadius: 10, cursor: "pointer", border: "1px solid #f0f0f0", marginBottom: 6, display: "flex", alignItems: "center", gap: 12 }}
                      onMouseEnter={e => { e.currentTarget.style.background = "#f7f8fc"; e.currentTarget.style.borderColor = "#6382ff"; }}
                      onMouseLeave={e => { e.currentTarget.style.background = "#fff"; e.currentTarget.style.borderColor = "#f0f0f0"; }}>
                      <div style={{ width: 36, height: 36, borderRadius: "50%", background: "linear-gradient(135deg,#6382ff,#a78bfa)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 800, color: "#fff", flexShrink: 0 }}>
                        {(vc.name || "?")[0]}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 700 }}>{vc.name || t("(無名)")}</div>
                        <div style={{ fontSize: 11, color: "#888", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {[vc.email, vc.phone, vc.phone_mainland].filter(Boolean).join(" · ")}
                        </div>
                      </div>
                    </div>
                  ))
                )}
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
              <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>{t("選擇本次列印使用的資訊")}</div>
              <div style={{ fontSize: 12, color: "#888", marginBottom: 18 }}>{t("此客戶在以下欄位存了多個值，請勾選本張發票/收據使用哪個。")}</div>
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
                <button onClick={() => setPrintFieldChooser(null)} style={{ background: "#f5f5f5", border: "none", borderRadius: 8, padding: "10px 18px", fontWeight: 600, cursor: "pointer" }}>{t("取消")}</button>
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
                >{t("下一步")}</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* PRINT CHOOSER MODAL */}
      {printChooser && (
        <div onClick={() => setPrintChooser(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: 28, width: 360, maxWidth: "90vw", boxShadow: "0 10px 40px rgba(0,0,0,0.2)" }}>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>{t("選擇列印內容")}</div>
            <div style={{ fontSize: 13, color: "#888", marginBottom: 18 }}>
              DC{String(printChooser.inv.invoice_number || "").replace(/^DC/i, "") || (printChooser.inv.id || "").slice(0, 8)}
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", border: "1px solid #eee", borderRadius: 10, marginBottom: 10, cursor: "pointer" }}>
              <input type="checkbox" checked={printWantInvoice} onChange={e => setPrintWantInvoice(e.target.checked)} style={{ width: 16, height: 16 }} />
              <span style={{ fontWeight: 600 }}>{t("發票 Invoice")}</span>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", border: "1px solid #eee", borderRadius: 10, marginBottom: 18, cursor: "pointer" }}>
              <input type="checkbox" checked={printWantReceipt} onChange={e => setPrintWantReceipt(e.target.checked)} style={{ width: 16, height: 16 }} />
              <span style={{ fontWeight: 600 }}>{t("收據 Receipt")}</span>
            </label>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button onClick={() => setPrintChooser(null)} style={{ background: "#f5f5f5", border: "none", borderRadius: 8, padding: "10px 18px", fontWeight: 600, cursor: "pointer" }}>{t("取消")}</button>
              <button
                disabled={!printWantInvoice && !printWantReceipt}
                onClick={() => {
                  const { inv, customer, items, products } = printChooser;
                  setPrintChooser(null);
                  printInvoice(inv, customer, items, products, { invoice: printWantInvoice, receipt: printWantReceipt });
                }}
                style={{ background: (!printWantInvoice && !printWantReceipt) ? "#ccc" : "#6382ff", color: "#fff", border: "none", borderRadius: 8, padding: "10px 18px", fontWeight: 700, cursor: (!printWantInvoice && !printWantReceipt) ? "not-allowed" : "pointer" }}
              >{t("確定列印")}</button>
            </div>
          </div>
        </div>
      )}

      {/* MARK PAID CONFIRM MODAL */}
      {markPaidCtx && (() => {
        const { inv, defaultWh, channel } = markPaidCtx;
        const isBroadway = channel === "broadway";
        const plan = isBroadway ? [] : buildDeductionPlan(inv, defaultWh);
        let itemsArr = inv.items;
        if (typeof itemsArr === "string") { try { itemsArr = JSON.parse(itemsArr); } catch { itemsArr = []; } }
        if (!Array.isArray(itemsArr)) itemsArr = [];
        const anyMissing = !isBroadway && itemsArr.some(it => !it.warehouse_id);
        const insufficient = plan.filter(p => !p.skip && p.after < 0);
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200 }}>
            <div style={{ background: "#fff", borderRadius: 16, padding: 24, width: 520, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
              <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 4 }}>{t("標記已付款")}</div>
              <div style={{ fontSize: 12, color: "#888", marginBottom: 16 }}>#{inv.invoice_number || inv.id} · {isBroadway ? t("百老匯渠道：不扣本地庫存") : t("將從庫存扣除對應數量")}</div>

              {/* 渠道選擇：自有 / 百老匯 */}
              <div style={{ marginBottom: 14, padding: "10px 12px", background: "#fafbff", borderRadius: 10, border: "1px solid #eef0fa" }}>
                <div style={{ fontSize: 11, color: "#888", marginBottom: 8, fontWeight: 700 }}>{t("渠道")}</div>
                <div style={{ display: "flex", gap: 8 }}>
                  {[
                    { k: "self", label: t("自有") },
                    { k: "broadway", label: t("百老匯") },
                  ].map(opt => (
                    <button key={opt.k} onClick={() => setMarkPaidCtx({ ...markPaidCtx, channel: opt.k })}
                      style={{ flex: 1, padding: "9px 12px", borderRadius: 8, border: channel === opt.k ? `2px solid ${opt.k === "broadway" ? "#dc2626" : "#6382ff"}` : "1px solid #e0e0e0", background: channel === opt.k ? (opt.k === "broadway" ? "#fee2e2" : "#eef2ff") : "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer", color: channel === opt.k ? (opt.k === "broadway" ? "#b91c1c" : "#3b58d4") : "#555" }}>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 自有渠道才顯示倉庫 picker + 扣減 plan */}
              {!isBroadway && anyMissing && (
                <div style={{ marginBottom: 14, padding: "12px 14px", background: "#fff8e1", borderRadius: 10, border: "1px solid #f4dca4" }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#8a6900", marginBottom: 8 }}>{t("此發票有商品未指定倉庫，統一扣：")}</div>
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
              {!isBroadway && (
                <div style={{ border: "1px solid #eef0fa", borderRadius: 10, overflow: "hidden", marginBottom: 14 }}>
                  <div style={{ background: "#fafbff", padding: "8px 12px", fontSize: 11, color: "#888", display: "grid", gridTemplateColumns: "1fr 48px 60px 72px", gap: 6 }}>
                    <div>{t("產品")}</div><div style={{ textAlign: "center" }}>{t("數量")}</div><div>{t("倉庫")}</div><div style={{ textAlign: "right" }}>{t("扣後")}</div>
                  </div>
                  {plan.map((p, i) => {
                    const wh = warehouses.find(w => w.id === p.warehouse_id);
                    return (
                      <div key={i} style={{ padding: "9px 12px", fontSize: 12, borderTop: "1px solid #f5f5f5", display: "grid", gridTemplateColumns: "1fr 48px 60px 72px", gap: 6, alignItems: "center", background: p.skip ? "#fafafa" : (p.after < 0 ? "#fff5f5" : "#fff") }}>
                        <div style={{ color: p.skip ? "#999" : "#222", fontStyle: p.skip ? "italic" : "normal" }}>{p.name || t("(空)")}</div>
                        <div style={{ textAlign: "center", color: "#555" }}>{p.qty}</div>
                        <div style={{ color: "#666", fontSize: 11 }}>{p.skip ? "—" : (wh ? wh.name.replace("分部", "") : t("？"))}</div>
                        <div style={{ textAlign: "right", fontWeight: 700, color: p.skip ? "#999" : (p.after < 0 ? "#e53935" : "#22c55e") }}>
                          {p.skip ? p.reason : `${p.current} → ${p.after}`}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {!isBroadway && insufficient.length > 0 && (
                <div style={{ marginBottom: 14, padding: "10px 14px", background: "#fff5f5", borderRadius: 10, border: "1px solid #f4c4c4", fontSize: 12, color: "#c53030" }}>
                  ⚠ {t("以下商品庫存不足，確認後將扣成負數：")}
                  <div style={{ marginTop: 4, fontSize: 11 }}>
                    {insufficient.map((p, i) => <div key={i}>• {p.name}：{t("剩")} {p.current}，{t("需扣")} {p.qty}</div>)}
                  </div>
                </div>
              )}
              {isBroadway && (
                <div style={{ marginBottom: 14, padding: "12px 14px", background: "#fee2e2", borderRadius: 10, border: "1px solid #fca5a5", fontSize: 12, color: "#991b1b" }}>
                  {t("百老匯渠道：不扣本地庫存")}
                </div>
              )}
              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={() => setMarkPaidCtx(null)} style={{ flex: 1, padding: 10, background: "#f5f5f5", color: "#555", border: "none", borderRadius: 10, fontWeight: 700, cursor: "pointer" }}>{t("取消")}</button>
                <button onClick={executeMarkPaid} disabled={anyMissing && !defaultWh} style={{ flex: 2, padding: 10, background: (anyMissing && !defaultWh) ? "#e0e0e0" : (isBroadway ? "#dc2626" : "#22c55e"), color: "#fff", border: "none", borderRadius: 10, fontWeight: 800, cursor: (anyMissing && !defaultWh) ? "not-allowed" : "pointer" }}>{isBroadway ? t("確認付款") : t("確認付款並扣庫存")}</button>
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
            <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4 }}>{t("庫存不足提醒")}</div>
            <div style={{ fontSize: 13, color: "#888", marginBottom: 10 }}>{t("以下")} {stockToast.items.length} {t("個 SKU 庫存為 0 或負數")}</div>
            <div style={{ fontSize: 13, color: "#333", maxHeight: 200, overflowY: "auto", lineHeight: 1.7 }}>
              {stockToast.items.slice(0, 10).map((n, i) => <div key={i} style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>• {n}</div>)}
              {stockToast.items.length > 10 && <div style={{ color: "#999", marginTop: 4 }}>... {t("還有")} {stockToast.items.length - 10} {t("個")}</div>}
            </div>
          </div>
          <button onClick={() => setStockToast(null)} title={t("關閉")} style={{ background: "none", border: "none", color: "#aaa", cursor: "pointer", fontSize: 24, padding: 0, lineHeight: 1, marginTop: -4 }}>×</button>
        </div>
      )}

      {/* ADD EMPLOYEE MODAL */}
      {showAddEmployee && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
          <div style={{ background: "#fff", borderRadius: 16, padding: 28, width: 460, boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>{t("新增員工")}</h2>
              <button onClick={() => { setShowAddEmployee(false); setNewEmployee({ name: "", role: "", phone: "", email: "", note: "" }); }} style={{ background: "#f5f5f5", border: "none", borderRadius: 8, padding: "6px 10px", cursor: "pointer" }}><Icon name="x" size={16} /></button>
            </div>
            <Input label={t("姓名 *")} value={newEmployee.name} onChange={v => setNewEmployee({ ...newEmployee, name: v })} placeholder={t("員工姓名")} />
            <Input label={t("職位")} value={newEmployee.role} onChange={v => setNewEmployee({ ...newEmployee, role: v })} placeholder={t("例如 客服 / 技術 / 銷售")} />
            <Input label={t("電話")} value={newEmployee.phone} onChange={v => setNewEmployee({ ...newEmployee, phone: v })} placeholder="+852" />
            <Input label="Email" value={newEmployee.email} onChange={v => setNewEmployee({ ...newEmployee, email: v })} placeholder="email@example.com" suggest={suggestEmail} />
            <Input label={t("備註")} value={newEmployee.note} onChange={v => setNewEmployee({ ...newEmployee, note: v })} placeholder={t("其他備註...")} />
            <button onClick={handleSaveEmployee} disabled={!newEmployee.name.trim()} style={{ width: "100%", padding: 12, background: newEmployee.name.trim() ? "#6382ff" : "#e0e0e0", color: "#fff", border: "none", borderRadius: 10, fontSize: 15, fontWeight: 800, cursor: newEmployee.name.trim() ? "pointer" : "not-allowed", marginTop: 8 }}>{t("儲存員工")}</button>
          </div>
        </div>
      )}

      {/* TASK DETAIL MODAL */}
      {/* 強制改密 modal — 員工首次用初始密碼登入時彈出，不可關閉，改完強制重新登入 */}
      {session && currentEmployee && currentEmployee.must_change_password === true && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200 }}>
          <div style={{ background: "#fff", borderRadius: 16, padding: 32, width: 420, boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
            <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 8 }}>🔐 {t("首次登入：請設置新密碼")}</div>
            <div style={{ fontSize: 12, color: "#888", marginBottom: 20, lineHeight: 1.6 }}>
              {t("為了你賬號的安全，請將初始密碼改為僅你自己知道的密碼。改完會自動退出，使用新密碼重新登入。")}
            </div>
            <input type="password" value={forceChangePw1} onChange={e => { setForceChangePw1(e.target.value); setForceChangePwErr(""); }} placeholder={t("新密碼（至少 6 位）")} autoFocus style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #e0e0e0", fontSize: 14, outline: "none", marginBottom: 10, boxSizing: "border-box" }} />
            <input type="password" value={forceChangePw2} onChange={e => { setForceChangePw2(e.target.value); setForceChangePwErr(""); }} placeholder={t("再次輸入新密碼")} style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #e0e0e0", fontSize: 14, outline: "none", marginBottom: 10, boxSizing: "border-box" }} />
            {forceChangePwErr && <div style={{ color: "#ef4444", fontSize: 12, marginBottom: 10 }}>{forceChangePwErr}</div>}
            <button disabled={forceChangePwLoading} onClick={async () => {
              if (forceChangePw1.length < 6) return setForceChangePwErr(t("密碼至少 6 位"));
              if (forceChangePw1 !== forceChangePw2) return setForceChangePwErr(t("兩次輸入不一致"));
              setForceChangePwLoading(true);
              const { error: e1 } = await supabase.auth.updateUser({ password: forceChangePw1 });
              if (e1) { setForceChangePwLoading(false); return setForceChangePwErr(e1.message); }
              const { error: e2 } = await supabase.from("employees").update({ must_change_password: false }).eq("id", currentEmployee.id);
              if (e2) { setForceChangePwLoading(false); return setForceChangePwErr(`${t("更新狀態失敗")}：${e2.message}`); }
              alert(t("密碼已修改，請使用新密碼重新登入"));
              await supabase.auth.signOut();
            }} style={{ width: "100%", padding: 12, background: forceChangePwLoading ? "#aaa" : "#6382ff", color: "#fff", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: forceChangePwLoading ? "wait" : "pointer" }}>{forceChangePwLoading ? t("處理中...") : t("修改並重新登入")}</button>
          </div>
        </div>
      )}

      {editingTask && (() => {
        const tk = editingTask;
        const subtasks = tasks.filter(s => s.parent_task_id === tk.id);
        const tkAssignees = assigneesByTask.get(tk.id) || [];
        const isTkAssignee = currentEmployee && tkAssignees.some(a => a.employee_id === currentEmployee.id);
        const isTkCreator = currentEmployee && tk.creator_employee_id === currentEmployee.id;
        // 改任務字段（標題/描述/截止日/優先級/附件/子任務結構）：僅 admin / 發布人
        // assignee 可以勾自己完成/放棄、加反饋（在下方分別 gate），但不能改任務內容
        const canEditTk = isBfAdmin || isTkCreator;
        // 改 assignees / needsApproval：同樣只 admin / 發布人
        const canManageMeta = isBfAdmin || isTkCreator;
        const ro = !canEditTk;
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 110 }}>
            <div style={{ background: "#fff", borderRadius: 16, padding: 28, width: 540, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
              {ro && (
                <div style={{ background: "#fff9ec", border: "1px solid #f4dca4", color: "#8a6900", padding: "8px 12px", borderRadius: 8, fontSize: 12, marginBottom: 12, fontWeight: 600 }}>
                  🔒 {t("只讀模式：只能查看，不能修改別人的任務")}
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <div style={{ display: "flex", gap: 8 }}>
                  {[{v:"high",l:t("高優"),c:"#ef4444"},{v:"mid",l:t("中優"),c:"#f59e0b"},{v:"low",l:t("低優"),c:"#22c55e"}].map(opt => {
                    const on = tk.priority === opt.v || (opt.v === "low" && (tk.priority === "none" || !tk.priority));
                    return (
                      <button key={opt.v} disabled={ro} onClick={() => !ro && handleUpdateTask(tk.id, { priority: opt.v })} style={{ fontSize: 12, fontWeight: 700, padding: "5px 12px", borderRadius: 20, border: "1px solid " + (on ? opt.c : "#e0e0e0"), background: on ? opt.c + "18" : "#fff", color: on ? opt.c : "#888", cursor: ro ? "not-allowed" : "pointer", opacity: ro ? 0.6 : 1 }}>{opt.l}</button>
                    );
                  })}
                </div>
                <button onClick={() => setEditingTask(null)} style={{ background: "#f5f5f5", border: "none", borderRadius: 8, padding: "6px 10px", cursor: "pointer" }}><Icon name="x" size={16} /></button>
              </div>
              <input value={tk.title} readOnly={ro} onChange={e => !ro && setEditingTask({ ...tk, title: e.target.value })} onBlur={() => !ro && handleUpdateTask(tk.id, { title: tk.title })} style={{ width: "100%", padding: "10px 0", fontSize: 22, fontWeight: 800, border: "none", outline: "none", marginBottom: 4, boxSizing: "border-box", background: "transparent", color: ro ? "#666" : "#222" }} />
              {/* 待核驗 banner：全員結算 + 需核驗 + 還沒終結 → 對 creator/admin 顯示「核驗通過」操作；對其他人僅提示 */}
              {isAwaitingApproval(tk) && (() => {
                const cr = employees.find(e3 => e3.id === tk.creator_employee_id);
                const crName = cr?.name || "發布人";
                const canApprove = isBfAdmin || isTkCreator;
                return (
                  <div style={{ background: "#fff4e0", border: "1px solid #f4dca4", borderRadius: 8, padding: "10px 14px", marginTop: 8, marginBottom: 8, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                    <div style={{ fontSize: 13, color: "#8a6900", fontWeight: 600 }}>
                      ⏳ {canApprove ? t("此任務全員已結算，等待你核驗") : t("等待") + " " + crName + " " + t("核驗中")}
                    </div>
                    {canApprove && (
                      <button onClick={() => handleApproveTask(tk)} style={{ background: "#f59e0b", color: "#fff", border: "none", borderRadius: 8, padding: "7px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                        ✓ {t("核驗通過")}
                      </button>
                    )}
                  </div>
                );
              })()}
              <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 8, marginBottom: 4 }}>
                <div style={{ fontSize: 12, color: "#888" }}>{t("截止日期")}</div>
                <input type="date" value={tk.due_date || ""} readOnly={ro} onChange={e => !ro && setEditingTask({ ...tk, due_date: e.target.value || null })} onBlur={() => !ro && handleUpdateTask(tk.id, { due_date: tk.due_date || null })} style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid #e0e0e0", fontSize: 12, outline: "none", background: ro ? "#fafbfc" : "#fff" }} />
                {tk.due_date && (() => {
                  const days = Math.ceil((new Date(tk.due_date) - new Date()) / (1000 * 60 * 60 * 24));
                  if (days < 0) return <span style={{ fontSize: 11, color: "#ef4444", fontWeight: 700 }}>⚠ {t("已過期")} {Math.abs(days)} {t("天")}</span>;
                  if (days <= 3) return <span style={{ fontSize: 11, color: "#f59e0b", fontWeight: 700 }}>⏰ {t("剩")} {days} {t("天")}</span>;
                  return <span style={{ fontSize: 11, color: "#888" }}>{t("剩")} {days} {t("天")}</span>;
                })()}
              </div>
              {/* 分配給 + 需核驗（admin / 發布人可改，其他人只讀） */}
              <div style={{ marginTop: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <div style={{ fontSize: 12, color: "#888" }}>{t("分配給")}</div>
                  <span style={{ fontSize: 11, color: "#bbb" }}>· {tkAssignees.length}</span>
                  {tk.creator_employee_id && (() => {
                    const cr = employees.find(e3 => e3.id === tk.creator_employee_id);
                    if (!cr) return null;
                    return <span style={{ fontSize: 11, color: "#888", marginLeft: "auto" }}>{t("發布人")}: <span style={{ color: "#3b58d4", fontWeight: 600 }}>{cr.name}</span></span>;
                  })()}
                </div>
                {(() => {
                  const curIds = tkAssignees.map(a => a.employee_id);
                  const q = editTaskAssigneeInput.replace(/^@/, '').toLowerCase();
                  const candidates = employees.filter(e2 => e2.active !== false && !curIds.includes(e2.id) && (q === '' || (e2.name || '').toLowerCase().includes(q)));
                  return (
                    <div style={{ position: "relative", border: `1px solid ${canManageMeta ? "#e0e0e0" : "#f0f0f0"}`, borderRadius: 8, padding: "5px 6px", display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center", background: canManageMeta ? "#fff" : "#fafbfc", minHeight: 30 }}>
                      {curIds.map(id => {
                        const e2 = employees.find(x => x.id === id);
                        return (
                          <span key={id} style={{ display: "inline-flex", alignItems: "center", gap: 3, padding: "2px 7px", background: "#eef2ff", color: "#3b58d4", borderRadius: 10, fontSize: 11, fontWeight: 700 }}>
                            @{e2?.name || "?"}
                            {canManageMeta && <button type="button" onClick={() => handleSetTaskAssignees(tk.id, curIds.filter(x => x !== id))} style={{ background: "none", border: "none", color: "#6382ff", cursor: "pointer", fontSize: 12, padding: 0, lineHeight: 1 }}>×</button>}
                          </span>
                        );
                      })}
                      {canManageMeta && (
                        <input
                          value={editTaskAssigneeInput}
                          onChange={e => { setEditTaskAssigneeInput(e.target.value); setEditTaskAssigneeOpen(true); }}
                          onFocus={() => setEditTaskAssigneeOpen(true)}
                          onBlur={() => setTimeout(() => setEditTaskAssigneeOpen(false), 200)}
                          onKeyDown={e => { if (e.key === 'Escape') setEditTaskAssigneeOpen(false); }}
                          placeholder={curIds.length === 0 ? "@ 添加成員" : ""}
                          style={{ flex: 1, minWidth: 80, padding: "3px 4px", border: "none", outline: "none", fontSize: 11, background: "transparent" }}
                        />
                      )}
                      {canManageMeta && editTaskAssigneeOpen && candidates.length > 0 && (
                        <div style={{ position: "absolute", top: "100%", left: 0, marginTop: 4, background: "#fff", border: "1px solid #d0d0d0", borderRadius: 8, boxShadow: "0 4px 14px rgba(0,0,0,0.1)", padding: 4, width: "100%", maxHeight: 200, overflowY: "auto", zIndex: 30 }}>
                          {candidates.map(e2 => (
                            <button key={e2.id} type="button" onMouseDown={ev => {
                              ev.preventDefault();
                              handleSetTaskAssignees(tk.id, [...curIds, e2.id]);
                              setEditTaskAssigneeInput("");
                            }} style={{ display: "block", width: "100%", textAlign: "left", padding: "6px 10px", background: "none", border: "none", fontSize: 12, color: "#333", cursor: "pointer", borderRadius: 4 }} onMouseOver={ev => ev.currentTarget.style.background = "#f5f5ff"} onMouseOut={ev => ev.currentTarget.style.background = "none"}>
                              {e2.name}{e2.role && <span style={{ color: "#aaa", marginLeft: 6, fontSize: 10 }}>{e2.role}</span>}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}
                {canManageMeta ? (
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 8, fontSize: 12, color: "#555", cursor: "pointer" }}>
                    <input type="checkbox" checked={!!tk.needs_approval} onChange={e => handleUpdateTask(tk.id, { needs_approval: e.target.checked })} style={{ width: 13, height: 13, margin: 0, cursor: "pointer" }} />
                    {t("完成後需發布人核驗")}
                  </label>
                ) : tk.needs_approval ? (
                  <div style={{ marginTop: 8, fontSize: 12, color: "#b06a00" }}>
                    ⏳ {(() => { const cr = employees.find(e3 => e3.id === tk.creator_employee_id); return `${t("此任務完成後需")} ${cr?.name || t("發布人")} ${t("核驗")}`; })()}
                  </div>
                ) : null}
              </div>
              <div style={{ fontSize: 12, color: "#888", marginBottom: 4, marginTop: 12 }}>{t("描述 / 備註")}</div>
              <textarea value={tk.note || ""} readOnly={ro} onChange={e => !ro && setEditingTask({ ...tk, note: e.target.value })} onBlur={() => !ro && handleUpdateTask(tk.id, { note: tk.note || null })} placeholder={t("輸入描述...")} style={{ width: "100%", minHeight: 60, padding: "8px 10px", borderRadius: 8, border: "1px solid #e0e0e0", fontSize: 13, outline: "none", resize: "vertical", boxSizing: "border-box", fontFamily: "inherit", background: ro ? "#fafbfc" : "#fff" }} />
              {/* 任務級附件（task.attachments） */}
              {(Array.isArray(tk.attachments) && tk.attachments.length > 0 || true) && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 12, color: "#888", marginBottom: 6 }}>📎 {t("任務附件")}{Array.isArray(tk.attachments) && tk.attachments.length > 0 && <span style={{ marginLeft: 4, color: "#aaa" }}>{tk.attachments.length}</span>}</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                    {Array.isArray(tk.attachments) && tk.attachments.map((a, i) => {
                      const isImg = (a.type || "").startsWith("image/");
                      return (
                        <div key={i} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                          {isImg ? (
                            <a href={a.url} target="_blank" rel="noopener noreferrer" title={a.name}>
                              <img src={a.url} style={{ maxWidth: 120, maxHeight: 80, borderRadius: 4, border: "1px solid #e0e0e0", display: "block" }} alt={a.name} />
                            </a>
                          ) : (
                            <a href={a.url} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 10px", background: "#fafbff", borderRadius: 6, fontSize: 11, color: "#3b58d4", textDecoration: "none", border: "1px solid #c6d3ff" }}>📎 {a.name}</a>
                          )}
                          {!ro && <button onClick={async () => {
                            if (!window.confirm(t("確定移除此附件？"))) return;
                            const rest = tk.attachments.filter((_, j) => j !== i);
                            await handleUpdateTask(tk.id, { attachments: rest.length > 0 ? rest : null });
                          }} title={t("移除")} style={{ background: "none", border: "none", color: "#ccc", cursor: "pointer", fontSize: 14, padding: 0 }}>×</button>}
                        </div>
                      );
                    })}
                    {!ro && <label style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "5px 10px", background: "#fafbff", border: "1px dashed #c6d3ff", borderRadius: 6, fontSize: 11, color: "#6382ff", cursor: "pointer" }}>
                      ＋ {t("添加")}
                      <input type="file" multiple style={{ display: "none" }} onChange={async e => {
                        const files = Array.from(e.target.files || []);
                        e.target.value = "";
                        if (files.length === 0) return;
                        try {
                          const newOnes = await Promise.all(files.map(f => uploadAttachment(f, tk.id)));
                          const merged = [...(Array.isArray(tk.attachments) ? tk.attachments : []), ...newOnes];
                          await handleUpdateTask(tk.id, { attachments: merged });
                        } catch (err) { alert(`${t("附件上傳失敗")}：${err.message}`); }
                      }} />
                    </label>}
                  </div>
                </div>
              )}
              <div style={{ fontSize: 12, color: "#888", marginTop: 16, marginBottom: 6 }}>{t("子任務")}</div>
              {subtasks.map((st, i) => {
                const stFbCount = feedbacks.filter(f => f.task_id === st.id).length;
                const stHasAttach = Array.isArray(st.attachments) && st.attachments.length > 0;
                return (
                <div key={st.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid #f5f5f5" }}>
                  {(() => {
                    const stIsMine = currentEmployee && (assigneesByTask.get(st.id) || []).some(a => a.employee_id === currentEmployee.id);
                    const canTickSt = isBfAdmin || isTkCreator || stIsMine;
                    return <input type="checkbox" checked={currentEmployee ? empIsDoneFor(st, currentEmployee.id) : st.status === "done"} disabled={!canTickSt} onChange={() => canTickSt && currentEmployee && handleToggleAssigneeDone(st, currentEmployee.id)} onClick={e => e.stopPropagation()} style={{ width: 15, height: 15, cursor: canTickSt ? "pointer" : "not-allowed" }} />;
                  })()}
                  <span onClick={() => setEditingTask(st)} title={t("打開子任務詳情（含獨立反饋線程）")} style={{ flex: 1, fontSize: 13, textDecoration: st.status === "done" ? "line-through" : "none", color: st.status === "done" ? "#999" : "#333", cursor: "pointer" }}>{st.title}</span>
                  {stFbCount > 0 && <span style={{ fontSize: 10, color: "#f59e0b" }}>💬 {stFbCount}</span>}
                  {stHasAttach && <span style={{ fontSize: 10, color: "#6382ff" }}>📎 {st.attachments.length}</span>}
                  {canDeleteTask(st) && <button onClick={() => handleDeleteTask(st.id)} title={t("刪除")} style={{ background: "none", border: "none", color: "#ccc", cursor: "pointer", fontSize: 14 }}>×</button>}
                </div>
                );
              })}
              {!ro && (() => {
                const parentAssigneeIds = tkAssignees.map(a => a.employee_id);
                const subAssignees = newSubTaskDraft.assigneeIds === null ? parentAssigneeIds : newSubTaskDraft.assigneeIds;
                const sq = subTaskAssigneeInput.replace(/^@/, '').toLowerCase();
                const subCandidates = employees.filter(e2 => e2.active !== false && !subAssignees.includes(e2.id) && (sq === '' || (e2.name || '').toLowerCase().includes(sq)));
                return (
                  <div style={{ marginTop: 8, padding: "8px 10px", border: "1px dashed #d0d0d0", borderRadius: 8, background: "#fafbff" }}>
                    <div style={{ fontSize: 11, color: "#888", marginBottom: 4 }}>{t("分配給")}</div>
                    <div style={{ position: "relative", border: "1px solid #e0e0e0", borderRadius: 6, padding: "3px 5px", marginBottom: 6, display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center", background: "#fff", minHeight: 26 }}>
                      {subAssignees.map(id => {
                        const e2 = employees.find(x => x.id === id);
                        return (
                          <span key={id} style={{ display: "inline-flex", alignItems: "center", gap: 3, padding: "1px 6px", background: "#eef2ff", color: "#3b58d4", borderRadius: 9, fontSize: 10, fontWeight: 700 }}>
                            @{e2?.name || "?"}
                            <button type="button" onClick={() => setNewSubTaskDraft(prev => ({ ...prev, assigneeIds: subAssignees.filter(x => x !== id) }))} style={{ background: "none", border: "none", color: "#6382ff", cursor: "pointer", fontSize: 11, padding: 0, lineHeight: 1 }}>×</button>
                          </span>
                        );
                      })}
                      <input
                        value={subTaskAssigneeInput}
                        onChange={e => { setSubTaskAssigneeInput(e.target.value); setSubTaskAssigneeOpen(true); }}
                        onFocus={() => setSubTaskAssigneeOpen(true)}
                        onBlur={() => setTimeout(() => setSubTaskAssigneeOpen(false), 200)}
                        onKeyDown={e => { if (e.key === 'Escape') setSubTaskAssigneeOpen(false); }}
                        placeholder={subAssignees.length === 0 ? "@ 添加成員" : ""}
                        style={{ flex: 1, minWidth: 70, padding: "2px 4px", border: "none", outline: "none", fontSize: 10, background: "transparent" }}
                      />
                      {subTaskAssigneeOpen && subCandidates.length > 0 && (
                        <div style={{ position: "absolute", top: "100%", left: 0, marginTop: 3, background: "#fff", border: "1px solid #d0d0d0", borderRadius: 8, boxShadow: "0 4px 14px rgba(0,0,0,0.1)", padding: 4, width: "100%", maxHeight: 180, overflowY: "auto", zIndex: 30 }}>
                          {subCandidates.map(e2 => (
                            <button key={e2.id} type="button" onMouseDown={ev => {
                              ev.preventDefault();
                              setNewSubTaskDraft(prev => ({ ...prev, assigneeIds: [...subAssignees, e2.id] }));
                              setSubTaskAssigneeInput("");
                            }} style={{ display: "block", width: "100%", textAlign: "left", padding: "5px 9px", background: "none", border: "none", fontSize: 11, color: "#333", cursor: "pointer", borderRadius: 4 }} onMouseOver={ev => ev.currentTarget.style.background = "#f5f5ff"} onMouseOut={ev => ev.currentTarget.style.background = "none"}>
                              {e2.name}{e2.role && <span style={{ color: "#aaa", marginLeft: 6, fontSize: 9 }}>{e2.role}</span>}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <form onSubmit={e => {
                      e.preventDefault();
                      const v = e.target.elements.sub.value.trim();
                      if (!v) return;
                      if (subAssignees.length === 0) { alert(t("請至少選擇一個負責人")); return; }
                      // 核驗跟隨父任務
                      handleAddTask(tk.employee_id, v, "none", tk.id, null, [], { assigneeIds: subAssignees, needsApproval: !!tk.needs_approval });
                      e.target.reset();
                      setNewSubTaskDraft({ assigneeIds: null });
                    }}>
                      <input name="sub" placeholder={t("+ 添加子任務（按 Enter 確認）")} style={{ width: "100%", padding: "7px 8px", borderRadius: 6, border: "1px solid #e0e0e0", fontSize: 13, outline: "none", boxSizing: "border-box", background: "#fff" }} />
                    </form>
                  </div>
                );
              })()}
              <div style={{ fontSize: 12, color: "#f59e0b", fontWeight: 700, marginTop: 16, marginBottom: 6 }}>💬 {t("反饋記錄")} <span style={{ fontSize: 11, color: "#b88a00", marginLeft: 4 }}>{feedbacks.filter(f => f.task_id === tk.id).length}</span></div>
              <div style={{ background: "#fff9ec", border: "1px solid #f4dca4", borderRadius: 8, padding: 10, marginBottom: 8, maxHeight: 280, overflowY: "auto" }}>
                {(() => {
                  const list = feedbacks.filter(f => f.task_id === tk.id).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
                  if (list.length === 0) return <div style={{ fontSize: 12, color: "#b8a76a", fontStyle: "italic", padding: "6px 4px" }}>{t("暫無反饋")}</div>;
                  return list.map(fb => {
                    const isOwn = fb.author_user_id === userId;
                    const canDelete = isOwn || isBfAdmin;
                    const isReply = !!fb.parent_feedback_id;
                    const parent = isReply ? list.find(p => p.id === fb.parent_feedback_id) : null;
                    return (
                      <div key={fb.id} style={{ background: "#fff", border: "1px solid #f4dca4", borderRadius: 6, padding: "7px 10px", marginBottom: 6, marginLeft: isReply ? 24 : 0, position: "relative" }}>
                        {isReply && (
                          <div style={{ fontSize: 10, color: "#b88a00", marginBottom: 3, fontStyle: "italic" }}>↪ {t("回復")} <b>{parent?.author_name || t("未知")}</b>: <span style={{ color: "#aaa" }}>{(parent?.body || "").slice(0, 30)}{(parent?.body || "").length > 30 ? "..." : ""}</span></div>
                        )}
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: "#8a6900" }}>
                            {fb.author_name || t("未知")}
                            <span style={{ fontWeight: 400, marginLeft: 6, color: "#aaa" }}>{new Date(fb.created_at).toLocaleString("zh-HK", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                          </div>
                          <div style={{ display: "flex", gap: 6 }}>
                            <button onClick={() => setReplyingToFb(fb.id)} title={t("回復此反饋")} style={{ background: "none", border: "none", color: "#b88a00", cursor: "pointer", fontSize: 11, padding: 0 }}>↩ {t("回復")}</button>
                            {canDelete && <button onClick={() => handleDeleteFeedback(fb.id)} title={t("刪除")} style={{ background: "none", border: "none", color: "#ccc", cursor: "pointer", fontSize: 14, padding: 0 }}>×</button>}
                          </div>
                        </div>
                        <div style={{ fontSize: 12, color: "#333", lineHeight: 1.5, whiteSpace: MARKDOWN_COMMENT_AUTHORS.has(fb.author_user_id) ? "normal" : "pre-wrap", wordBreak: "break-word" }}>
                          {MARKDOWN_COMMENT_AUTHORS.has(fb.author_user_id) ? <MarkdownText text={fb.body} fontSize={12} /> : fb.body}
                        </div>
                        {Array.isArray(fb.attachments) && fb.attachments.length > 0 && (
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                            {fb.attachments.map((a, i) => {
                              const isImg = (a.type || "").startsWith("image/");
                              return isImg ? (
                                <a key={i} href={a.url} target="_blank" rel="noopener noreferrer" title={a.name}>
                                  <img src={a.url} style={{ maxWidth: 140, maxHeight: 90, borderRadius: 4, border: "1px solid #e0e0e0", display: "block" }} alt={a.name} />
                                </a>
                              ) : (
                                <a key={i} href={a.url} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 8px", background: "#fff", borderRadius: 6, fontSize: 11, color: "#555", textDecoration: "none", border: "1px solid #e0e0e0" }}>📎 {a.name}</a>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  });
                })()}
              </div>
              {replyingToFb && (() => {
                const target = feedbacks.find(f => f.id === replyingToFb);
                if (!target) return null;
                return (
                  <div style={{ background: "#fff4d6", border: "1px solid #f4dca4", borderRadius: 6, padding: "5px 10px", marginBottom: 6, fontSize: 11, color: "#8a6900", display: "flex", alignItems: "center", gap: 6 }}>
                    ↩ {t("回復")} <b>{target.author_name || t("未知")}</b>: <span style={{ flex: 1, color: "#b88a00", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{(target.body || "").slice(0, 60)}</span>
                    <button onClick={() => setReplyingToFb(null)} style={{ background: "none", border: "none", color: "#b88a00", cursor: "pointer", fontSize: 14, padding: 0 }}>×</button>
                  </div>
                );
              })()}
              {pendingAttachments.length > 0 && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
                  {pendingAttachments.map((f, i) => (
                    <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 8px", background: "#fff4d6", borderRadius: 6, fontSize: 11, color: "#8a6900", border: "1px solid #f4dca4" }}>
                      📎 {f.name}
                      <button onClick={() => setPendingAttachments(prev => prev.filter((_, j) => j !== i))} style={{ background: "none", border: "none", color: "#b88a00", cursor: "pointer", fontSize: 12, padding: 0, marginLeft: 2 }}>×</button>
                    </span>
                  ))}
                </div>
              )}
              {/* @ 提醒：輸入 @ 觸發下拉，選員工後插入「@姓名 」+ 記錄 user_id */}
              {(() => {
                // 所有綁了帳號的活躍員工都能 @（排除自己）
                const mentionables = employees.filter(e => e.active !== false && e.user_id && e.id !== currentEmployee?.id);
                const filtered = mentionPopup.open ? mentionables.filter(e => !mentionPopup.query || (e.name || "").toLowerCase().includes(mentionPopup.query.toLowerCase())) : [];

                const handleChange = (e) => {
                  const val = e.target.value;
                  const cursor = e.target.selectionStart;
                  setFbInputValue(val);
                  const before = val.slice(0, cursor);
                  const atIdx = before.lastIndexOf('@');
                  if (atIdx === -1) { setMentionPopup({ open: false, query: "", atIdx: -1 }); return; }
                  const between = before.slice(atIdx + 1);
                  if (/\s/.test(between)) { setMentionPopup({ open: false, query: "", atIdx: -1 }); return; }
                  setMentionPopup({ open: true, query: between, atIdx });
                };

                const selectMention = (emp) => {
                  const atIdx = mentionPopup.atIdx;
                  const before = fbInputValue.slice(0, atIdx);
                  // 找 @ 後到光標位置（query）的結束位置：找下一個空格或 end
                  const afterAt = fbInputValue.slice(atIdx + 1);
                  let queryEnd = afterAt.search(/\s/);
                  if (queryEnd === -1) queryEnd = afterAt.length;
                  const rest = afterAt.slice(queryEnd);
                  const newVal = `${before}@${emp.name} ${rest.replace(/^\s+/, '')}`;
                  setFbInputValue(newVal);
                  setPendingMentions(prev => Array.from(new Set([...prev, emp.user_id])));
                  setMentionPopup({ open: false, query: "", atIdx: -1 });
                };

                return (
                  <>
                    <form onSubmit={async e => {
                      e.preventDefault();
                      const v = fbInputValue;
                      if ((v && v.trim()) || pendingAttachments.length > 0) {
                        await handleAddFeedback(tk.id, v, pendingAttachments, replyingToFb, pendingMentions);
                        setFbInputValue("");
                        setMentionPopup({ open: false, query: "", atIdx: -1 });
                      }
                    }} style={{ display: "flex", gap: 6, position: "relative" }}>
                      <label style={{ display: "inline-flex", alignItems: "center", padding: "8px 10px", background: "#fff9ec", border: "1px solid #f4dca4", borderRadius: 8, fontSize: 14, cursor: "pointer" }} title={t("添加附件")}>
                        📎
                        <input type="file" multiple style={{ display: "none" }} onChange={e => { const files = Array.from(e.target.files || []); setPendingAttachments(prev => [...prev, ...files]); e.target.value = ""; }} />
                      </label>
                      <textarea
                        name="fb"
                        value={fbInputValue}
                        onChange={handleChange}
                        onKeyDown={e => {
                          if (e.key === 'Escape') setMentionPopup({ open: false, query: "", atIdx: -1 });
                          // Cmd/Ctrl + Enter 提交（避免 Enter 換行被吃掉）
                          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                            e.preventDefault();
                            e.currentTarget.form?.requestSubmit();
                          }
                        }}
                        placeholder={t("追加反饋... 輸入 @ 提醒某人；Cmd+Enter 發送")}
                        autoComplete="off"
                        rows={2}
                        style={{ flex: 1, padding: "8px 10px", borderRadius: 8, border: "1px solid #f4dca4", fontSize: 12, outline: "none", boxSizing: "border-box", background: "#fff", resize: "vertical", fontFamily: "inherit" }}
                      />
                      <button type="submit" style={{ background: "#f59e0b", color: "#fff", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>{t("發送")}</button>
                      {mentionPopup.open && filtered.length > 0 && (
                        <div style={{ position: "absolute", bottom: "100%", left: 44, marginBottom: 4, background: "#fff", border: "1px solid #d0d0d0", borderRadius: 8, boxShadow: "0 4px 14px rgba(0,0,0,0.1)", padding: 4, minWidth: 180, maxHeight: 200, overflowY: "auto", zIndex: 50 }}>
                          {filtered.map(emp => (
                            <button key={emp.id} type="button" onMouseDown={ev => { ev.preventDefault(); selectMention(emp); }} style={{ display: "block", width: "100%", textAlign: "left", padding: "6px 10px", background: "none", border: "none", fontSize: 12, color: "#333", cursor: "pointer", borderRadius: 4 }} onMouseOver={ev => ev.currentTarget.style.background = "#f5f5ff"} onMouseOut={ev => ev.currentTarget.style.background = "none"}>
                              {emp.name}{emp.role && <span style={{ color: "#aaa", marginLeft: 6, fontSize: 10 }}>{emp.role}</span>}
                            </button>
                          ))}
                        </div>
                      )}
                    </form>
                    {pendingMentions.length > 0 && (
                      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 5, alignItems: "center" }}>
                        <span style={{ fontSize: 10, color: "#888" }}>{t("將提醒")}:</span>
                        {pendingMentions.map(uid => {
                          const emp = employees.find(e2 => e2.user_id === uid);
                          if (!emp) return null;
                          return (
                            <span key={uid} style={{ display: "inline-flex", alignItems: "center", gap: 3, padding: "2px 7px", background: "#fff4d6", color: "#8a6900", borderRadius: 10, fontSize: 10, fontWeight: 700, border: "1px solid #f4dca4" }}>
                              @{emp.name}
                              <button type="button" onClick={() => setPendingMentions(prev => prev.filter(id => id !== uid))} style={{ background: "none", border: "none", color: "#b88a00", cursor: "pointer", fontSize: 11, padding: 0 }}>×</button>
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </>
                );
              })()}
              <div style={{ fontSize: 11, color: "#aaa", marginTop: 16, display: "flex", gap: 14, flexWrap: "wrap" }}>
                <span>📅 {t("添加於")} {new Date(tk.created_at).toLocaleString("zh-HK", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                {tk.status === "done" && tk.completed_at && <span style={{ color: "#22c55e" }}>✓ {t("完成於")} {new Date(tk.completed_at).toLocaleString("zh-HK", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>}
                {tk.status === "abandoned" && tk.completed_at && <span>✗ {t("放棄於")} {new Date(tk.completed_at).toLocaleString("zh-HK", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16, paddingTop: 16, borderTop: "1px solid #f0f0f0" }}>
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  {canDeleteTask(tk) && <button onClick={() => handleDeleteTask(tk.id)} style={{ background: "none", border: "none", color: "#e53935", fontSize: 13, cursor: "pointer" }}>🗑 {t("刪除任務")}</button>}
                  {(() => {
                    // 「我放棄」只給 assignee 用（admin/creator 不是執行人，不該用此按鈕；他們應改 task 整體狀態走別的入口）
                    if (!isTkAssignee || !currentEmployee) return null;
                    const myRow = (assigneesByTask.get(tk.id) || []).find(a => a.employee_id === currentEmployee.id);
                    const myAbandoned = myRow?.abandoned_at != null || (!myRow && tk.status === "abandoned");
                    const tkAssigneeIds = (assigneesByTask.get(tk.id) || []).map(a => a.employee_id);
                    const isMulti = tkAssigneeIds.length > 1;
                    const label = isMulti || tk.needs_approval ? (myAbandoned ? t("恢復我的進行") : t("我放棄此任務")) : (myAbandoned ? t("恢復進行") : t("放棄此任務"));
                    return <button onClick={() => handleToggleAssigneeAbandoned(tk, currentEmployee.id)} style={{ background: "none", border: "none", color: myAbandoned ? "#6382ff" : "#888", fontSize: 13, cursor: "pointer" }}>✗ {label}</button>;
                  })()}
                </div>
                <button onClick={() => setEditingTask(null)} style={{ background: "#6382ff", color: "#fff", border: "none", borderRadius: 10, padding: "9px 20px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>{t("完成")}</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* 任務提醒 toast 堆疊（iOS 通知風格，右下角從下往上堆） */}
      {taskNotices.length > 0 && currentEmployee && (
        <div style={{ position: 'fixed', bottom: 20, right: 20, display: 'flex', flexDirection: 'column-reverse', gap: 10, zIndex: 200, maxWidth: 360 }}>
          {taskNotices.map(notice => {
            const isApproval = notice.type === 'approval';
            const isFeedback = notice.type === 'feedback';
            const borderColor = isApproval ? '#f4dca4' : isFeedback ? '#fcd5b8' : '#c6d3ff';
            const titleColor = isApproval ? '#b06a00' : isFeedback ? '#c2410c' : '#3b58d4';
            const viewBtnColor = isApproval ? '#f59e0b' : isFeedback ? '#ea580c' : '#6382ff';
            const dismiss = () => setDismissedNoticeTypes(prev => new Set([...prev, notice.type]));
            const viewAndDismiss = () => {
              // 標記 feedback 已讀（保留 bizflow 本地 seen 記錄）
              if (isFeedback && notice.ids && notice.ids.length > 0 && userId) {
                const seenFbKey = `bf_seen_fb_${userId}`;
                let seen = [];
                try { seen = JSON.parse(localStorage.getItem(seenFbKey) || '[]'); } catch {}
                const merged = Array.from(new Set([...seen, ...notice.ids]));
                localStorage.setItem(seenFbKey, JSON.stringify(merged));
              }
              // 跳到 team 子應用查看（任務管理已遷出）
              window.location.href = 'https://team.honnmono.top';
              dismiss();
            };
            let title;
            if (isApproval) {
              title = `⏳ ${t("你有")} ${notice.count} ${t("個任務待你核驗")}`;
            } else if (isFeedback) {
              const titles = (notice.tasks || []).slice(0, 2).map(x => `「${x.title}」`).join('、');
              const more = (notice.tasks || []).length > 2 ? ` ${t("等")}` : '';
              title = `💬 ${titles}${more} ${t("有新反饋")}`;
            } else {
              title = `📋 ${t("你有")} ${notice.count} ${t("個任務待處理")}`;
            }
            return (
              <div key={notice.type} style={{ background: '#fff', border: `1px solid ${borderColor}`, borderRadius: 12, padding: 16, boxShadow: '0 8px 24px rgba(0,0,0,0.15)', minWidth: 280 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: titleColor, marginBottom: 10 }}>{title}</div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button onClick={dismiss} style={{ fontSize: 12, padding: '6px 14px', background: '#f0f0f0', border: 'none', borderRadius: 8, cursor: 'pointer', color: '#666' }}>{t("關閉")}</button>
                  <button onClick={viewAndDismiss} style={{ fontSize: 12, padding: '6px 14px', background: viewBtnColor, color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700 }}>{t("查看")}</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 供應商：新增 + 編輯 modal */}
      {(showAddSupplier || editingSupplier) && (() => {
        const isEdit = !!editingSupplier;
        const v = isEdit ? editingSupplier : newSupplier;
        const setV = isEdit ? (patch) => setEditingSupplier({ ...editingSupplier, ...patch }) : (patch) => setNewSupplier({ ...newSupplier, ...patch });
        const close = () => { if (isEdit) setEditingSupplier(null); else { setShowAddSupplier(false); setNewSupplier({ name: "", contact_url: "", contact_person: "", category: "", note: "" }); } };
        const submit = async () => {
          if (!v.name?.trim()) { alert(t("名稱必填")); return; }
          if (isEdit) {
            await handleUpdateSupplier(editingSupplier.id, {
              name: v.name.trim(),
              contact_url: v.contact_url?.trim() || null,
              contact_person: v.contact_person?.trim() || null,
              category: v.category?.trim() || null,
              note: v.note?.trim() || null,
            });
            setEditingSupplier(null);
          } else {
            await handleSaveSupplier();
          }
        };
        const inp = (label, key, type = "text") => (
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "#666", fontWeight: 600, marginBottom: 12 }}>
            {label}
            {type === "textarea" ? (
              <textarea value={v[key] || ""} onChange={e => setV({ [key]: e.target.value })} rows={3} style={{ padding: "9px 12px", borderRadius: 8, border: "1px solid #e0e0e0", fontSize: 13, outline: "none", fontFamily: "inherit", resize: "vertical" }} />
            ) : (
              <input value={v[key] || ""} onChange={e => setV({ [key]: e.target.value })} style={{ padding: "9px 12px", borderRadius: 8, border: "1px solid #e0e0e0", fontSize: 13, outline: "none" }} />
            )}
          </label>
        );
        return (
          <div onClick={close} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
            <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: 28, width: 500, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
              <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 18 }}>{isEdit ? t("編輯供應商") : t("新增供應商")}</div>
              {inp(t("名稱") + " *", "name")}
              <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "#666", fontWeight: 600, marginBottom: 12 }}>
                {t("聯繫鏈接")}
                <input value={v.contact_url || ""} onChange={e => setV({ contact_url: e.target.value })} placeholder="https://wa.me/85296... 或 wxwork://message?username=xxx 或 mailto:..." style={{ padding: "9px 12px", borderRadius: 8, border: "1px solid #e0e0e0", fontSize: 13, outline: "none", fontFamily: "monospace" }} />
                <span style={{ fontSize: 10, color: "#aaa", fontWeight: 400 }}>{t("企業微信內部同事用 wxwork://message?username=xxx；外部公司建議用 WhatsApp / 電話 / 郵箱")}</span>
              </label>
              {inp(t("對接人"), "contact_person")}
              {inp(t("分類"), "category")}
              {inp(t("備註"), "note", "textarea")}
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
                <button onClick={close} style={{ background: "#f5f5f5", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer", color: "#666" }}>{t("取消")}</button>
                <button onClick={submit} style={{ background: "#6382ff", color: "#fff", border: "none", borderRadius: 8, padding: "9px 20px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>{t("保存")}</button>
              </div>
            </div>
          </div>
        );
      })()}

      <AddCustomerModal
        showAddCustomer={showAddCustomer} setShowAddCustomer={setShowAddCustomer}
        newCustomer={newCustomer} setNewCustomer={setNewCustomer}
        saving={saving}
        handleSaveCustomer={handleSaveCustomer}
      />

      {/* EDIT PRODUCT STOCK MODAL (分倉) */}
      {/* LINE ITEM ALIAS EDIT MODAL */}

      <ProductEditModal
        editingProduct={editingProduct} setEditingProduct={setEditingProduct}
        editStocks={editStocks} setEditStocks={setEditStocks}
        editProductPrice={editProductPrice} setEditProductPrice={setEditProductPrice}
        editProductWarranty={editProductWarranty} setEditProductWarranty={setEditProductWarranty}
      />
      <ProductNewModal
        newProductOpen={newProductOpen} setNewProductOpen={setNewProductOpen}
        newProduct={newProduct} setNewProduct={setNewProduct}
        newProductSaving={newProductSaving} setNewProductSaving={setNewProductSaving}
      />
    </div>
  );
}
