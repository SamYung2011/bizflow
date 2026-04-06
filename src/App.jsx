import { useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

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
    shopify: <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M15.337 23.979l7.216-1.561s-2.604-17.613-2.625-17.73c-.018-.116-.117-.192-.232-.192-.117 0-2.161-.043-2.161-.043s-1.445-1.412-1.593-1.562v21.088zm-2.322.021L12.943 0S9.582.79 8.458.79C7.367.79 5.84.21 5.04 0L4.459 24l8.556-.001z"/></svg>,
    trend_up: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>,
  };
  return icons[name] || null;
};

// ── STATUS BADGE ───────────────────────────────────────────────────────────────
const Badge = ({ status }) => {
  const map = {
    "In Stock": { bg: "#e8f5e9", color: "#2e7d32", dot: "#4caf50" },
    "Sold": { bg: "#e3f2fd", color: "#1565c0", dot: "#2196f3" },
    "Warranty Expiring": { bg: "#fff3e0", color: "#e65100", dot: "#ff9800" },
    "Expired": { bg: "#fce4ec", color: "#b71c1c", dot: "#f44336" },
    "Paid": { bg: "#e8f5e9", color: "#2e7d32", dot: "#4caf50" },
    "Pending": { bg: "#fff3e0", color: "#e65100", dot: "#ff9800" },
    "VIP": { bg: "#f3e5f5", color: "#6a1b9a", dot: "#9c27b0" },
    "Regular": { bg: "#f5f5f5", color: "#424242", dot: "#9e9e9e" },
  };
  const s = map[status] || { bg: "#f5f5f5", color: "#333", dot: "#999" };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 10px", borderRadius: 20, background: s.bg, color: s.color, fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: s.dot }} />
      {status}
    </span>
  );
};

// ── STAT CARD ──────────────────────────────────────────────────────────────────
const StatCard = ({ label, value, sub, accent, icon }) => (
  <div style={{ background: "#fff", borderRadius: 16, padding: "24px 28px", border: "1px solid #f0f0f0", boxShadow: "0 2px 12px rgba(0,0,0,0.04)", display: "flex", flexDirection: "column", gap: 8, position: "relative", overflow: "hidden" }}>
    <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: accent, borderRadius: "16px 16px 0 0" }} />
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
      <div>
        <div style={{ fontSize: 13, color: "#888", fontWeight: 500, letterSpacing: "0.04em", textTransform: "uppercase" }}>{label}</div>
        <div style={{ fontSize: 32, fontWeight: 800, color: "#1a1a2e", lineHeight: 1.2, marginTop: 4 }}>{value}</div>
        {sub && <div style={{ fontSize: 13, color: "#aaa", marginTop: 4 }}>{sub}</div>}
      </div>
      <div style={{ width: 42, height: 42, borderRadius: 12, background: accent + "18", display: "flex", alignItems: "center", justifyContent: "center", color: accent }}>
        {icon}
      </div>
    </div>
  </div>
);

// ── MAIN APP ───────────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState("dashboard");
  const [products, setProducts] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showNewInvoice, setShowNewInvoice] = useState(false);
  const [newInvoice, setNewInvoice] = useState({ customerId: "", items: [{ productId: "", qty: 1 }], notes: "", warranty: false });
  const [invoiceGenerated, setInvoiceGenerated] = useState(false);

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      const [prodRes, custRes, invRes, invtRes] = await Promise.all([
        supabase.from("products").select("*"),
        supabase.from("customers").select("*"),
        supabase.from("invoices").select("*").order("invoice_number", { ascending: false }),
        supabase.from("inventory").select("*"),
      ]);
      if (prodRes.data) setProducts(prodRes.data.map(p => ({
        ...p, code: p.code || "", category: p.category || "", stock: p.stock || 0,
        warrantyMonths: p.warranty_months || 12, specs: p.specs || ""
      })));
      if (custRes.data) setCustomers(custRes.data.map(c => ({
        ...c, company: c.company || "", type: c.type || "Regular"
      })));
      if (invRes.data) setInvoices(invRes.data.map(i => ({
        ...i, customerId: i.customer_id, invoiceNumber: i.invoice_number,
        items: i.items || [], total: Number(i.total) || 0
      })));
      if (invtRes.data) setInventory(invtRes.data.map(v => ({
        ...v, productId: v.product_id, serialNo: v.serial_no, customerId: v.customer_id,
        soldDate: v.sold_date, warrantyEnd: v.warranty_end, extendedEnd: v.extended_end
      })));
      setLoading(false);
    }
    fetchData();
  }, []);

  const getProduct = (id) => products.find(p => p.id === id);
  const getCustomer = (id) => customers.find(c => c.id === id);

  const warrantyAlerts = inventory.filter(i => i.status === "Warranty Expiring");
  const totalRevenue = invoices.reduce((s, i) => s + i.total, 0);
  const inStock = inventory.filter(i => i.status === "In Stock").length;

  const navItems = [
    { id: "dashboard", label: "Dashboard", icon: "dashboard" },
    { id: "inventory", label: "Inventory", icon: "inventory" },
    { id: "products", label: "Products", icon: "product" },
    { id: "customers", label: "Customers", icon: "customer" },
    { id: "invoices", label: "Invoices", icon: "invoice" },
  ];

  const handleGenerateInvoice = () => {
    setInvoiceGenerated(true);
    setTimeout(() => {
      setInvoiceGenerated(false);
      setShowNewInvoice(false);
      setNewInvoice({ customerId: "", items: [{ productId: "", qty: 1 }], notes: "", warranty: false });
    }, 2500);
  };

  const invoiceTotal = newInvoice.items.reduce((sum, item) => {
    const p = getProduct(item.productId);
    return sum + (p ? p.price * item.qty : 0);
  }, 0);

  if (loading) {
    return (
      <div style={{ display: "flex", height: "100vh", alignItems: "center", justifyContent: "center", fontFamily: "'DM Sans', 'Helvetica Neue', sans-serif", background: "#f7f8fc", color: "#1a1a2e" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 24, fontWeight: 800 }}>BizFlow</div>
          <div style={{ fontSize: 14, color: "#888", marginTop: 8 }}>Loading data...</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", height: "100vh", fontFamily: "'DM Sans', 'Helvetica Neue', sans-serif", background: "#f7f8fc", color: "#1a1a2e" }}>

      {/* ── SIDEBAR ── */}
      <aside style={{ width: 220, background: "#1a1a2e", display: "flex", flexDirection: "column", padding: "0", flexShrink: 0 }}>
        <div style={{ padding: "28px 24px 20px", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#fff", letterSpacing: "-0.5px" }}>BizFlow</div>
          <div style={{ fontSize: 11, color: "#6b7bb8", marginTop: 2, letterSpacing: "0.08em", textTransform: "uppercase" }}>Business Suite</div>
        </div>

        {warrantyAlerts.length > 0 && (
          <div style={{ margin: "12px 14px", background: "#ff9800", borderRadius: 10, padding: "10px 14px", display: "flex", alignItems: "center", gap: 8 }}>
            <Icon name="warning" size={14} />
            <div style={{ color: "#fff", fontSize: 12, fontWeight: 600 }}>{warrantyAlerts.length} warranty expiring</div>
          </div>
        )}

        <nav style={{ flex: 1, padding: "12px 10px", display: "flex", flexDirection: "column", gap: 2 }}>
          {navItems.map(n => (
            <button key={n.id} onClick={() => setTab(n.id)} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 14px", borderRadius: 10, border: "none", cursor: "pointer", background: tab === n.id ? "rgba(99,130,255,0.18)" : "transparent", color: tab === n.id ? "#7c9dff" : "#8899cc", fontSize: 14, fontWeight: tab === n.id ? 700 : 500, textAlign: "left", transition: "all 0.15s" }}>
              <Icon name={n.icon} size={17} />
              {n.label}
            </button>
          ))}
        </nav>

        <div style={{ padding: "16px 14px", borderTop: "1px solid rgba(255,255,255,0.07)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", background: "rgba(99,130,255,0.1)", borderRadius: 10 }}>
            <div style={{ width: 30, height: 30, borderRadius: "50%", background: "linear-gradient(135deg,#7c9dff,#a78bfa)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "#fff" }}>A</div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>Admin</div>
              <div style={{ fontSize: 11, color: "#6b7bb8" }}>Owner</div>
            </div>
          </div>
        </div>
      </aside>

      {/* ── MAIN ── */}
      <main style={{ flex: 1, overflow: "auto", padding: "32px 36px" }}>

        {/* ══ DASHBOARD ══ */}
        {tab === "dashboard" && (
          <div>
            <div style={{ marginBottom: 28 }}>
              <h1 style={{ fontSize: 26, fontWeight: 800, margin: 0, letterSpacing: "-0.5px" }}>Good morning 👋</h1>
              <p style={{ color: "#888", margin: "4px 0 0", fontSize: 15 }}>Here's what's happening with your business today.</p>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 28 }}>
              <StatCard label="Total Revenue" value={`$${totalRevenue.toLocaleString()}`} sub="All invoices" accent="#6382ff" icon={<Icon name="trend_up" size={20} />} />
              <StatCard label="Units In Stock" value={inStock} sub={`of ${inventory.length} total units`} accent="#22c55e" icon={<Icon name="inventory" size={20} />} />
              <StatCard label="Active Customers" value={customers.length} sub="All time" accent="#f59e0b" icon={<Icon name="customer" size={20} />} />
              <StatCard label="Warranty Alerts" value={warrantyAlerts.length} sub="Need follow-up" accent="#ef4444" icon={<Icon name="warning" size={20} />} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
              {/* Recent Invoices */}
              <div style={{ background: "#fff", borderRadius: 16, padding: 24, border: "1px solid #f0f0f0", boxShadow: "0 2px 12px rgba(0,0,0,0.04)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                  <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Recent Invoices</h2>
                  <button onClick={() => setTab("invoices")} style={{ fontSize: 13, color: "#6382ff", background: "none", border: "none", cursor: "pointer", fontWeight: 600 }}>View all →</button>
                </div>
                {invoices.map(inv => {
                  const c = getCustomer(inv.customerId);
                  return (
                    <div key={inv.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0", borderBottom: "1px solid #f5f5f5" }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>{inv.id}</div>
                        <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>{c?.name} · {inv.date}</div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <span style={{ fontWeight: 700, fontSize: 15 }}>${inv.total}</span>
                        <Badge status={inv.status} />
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Warranty Alerts */}
              <div style={{ background: "#fff", borderRadius: 16, padding: 24, border: "1px solid #f0f0f0", boxShadow: "0 2px 12px rgba(0,0,0,0.04)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                  <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>🔔 Warranty Alerts</h2>
                  <Badge status="Warranty Expiring" />
                </div>
                {warrantyAlerts.length === 0 ? (
                  <div style={{ color: "#aaa", fontSize: 14, textAlign: "center", paddingTop: 20 }}>No alerts right now ✓</div>
                ) : warrantyAlerts.map(item => {
                  const p = getProduct(item.productId);
                  const c = getCustomer(item.customerId);
                  return (
                    <div key={item.id} style={{ background: "#fff8f0", border: "1px solid #ffe0b2", borderRadius: 12, padding: "14px 16px", marginBottom: 10 }}>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{p?.name}</div>
                      <div style={{ fontSize: 12, color: "#666", marginTop: 3 }}>SN: {item.serialNo} · Customer: {c?.name}</div>
                      <div style={{ fontSize: 12, color: "#e65100", marginTop: 4, fontWeight: 600 }}>Warranty ends: {item.warrantyEnd}</div>
                      <button style={{ marginTop: 8, fontSize: 12, background: "#ff9800", color: "#fff", border: "none", borderRadius: 6, padding: "5px 12px", cursor: "pointer", fontWeight: 600 }}>
                        Contact Customer →
                      </button>
                    </div>
                  );
                })}

                <div style={{ marginTop: 16, padding: "14px 16px", background: "#f0f7ff", borderRadius: 12, border: "1px solid #bbdefb" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <Icon name="shopify" size={14} />
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#1565c0" }}>Shopify Connected</span>
                  </div>
                  <div style={{ fontSize: 12, color: "#555" }}>3 new orders synced today. Inventory auto-updated.</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ══ INVENTORY ══ */}
        {tab === "inventory" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
              <div>
                <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>Inventory</h1>
                <p style={{ color: "#888", margin: "4px 0 0", fontSize: 14 }}>Track every unit — serial number, warranty, customer</p>
              </div>
              <button style={{ display: "flex", alignItems: "center", gap: 8, background: "#1a1a2e", color: "#fff", border: "none", borderRadius: 10, padding: "10px 18px", cursor: "pointer", fontWeight: 700, fontSize: 14 }}>
                <Icon name="plus" size={16} /> Add Unit
              </button>
            </div>

            <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #f0f0f0", boxShadow: "0 2px 12px rgba(0,0,0,0.04)", overflow: "hidden" }}>
              <div style={{ padding: "16px 20px", borderBottom: "1px solid #f5f5f5", display: "flex", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#f7f8fc", borderRadius: 8, padding: "8px 14px", flex: 1 }}>
                  <Icon name="search" size={15} />
                  <input placeholder="Search by serial number, product, customer..." value={search} onChange={e => setSearch(e.target.value)} style={{ border: "none", background: "none", outline: "none", fontSize: 14, width: "100%" }} />
                </div>
              </div>

              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                <thead>
                  <tr style={{ background: "#fafafa" }}>
                    {["Serial No.", "Product", "Status", "Customer", "Sold Date", "Warranty End", "Extended", "Notes"].map(h => (
                      <th key={h} style={{ padding: "12px 16px", textAlign: "left", fontSize: 12, fontWeight: 700, color: "#888", letterSpacing: "0.05em", textTransform: "uppercase", borderBottom: "1px solid #f0f0f0" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {inventory.filter(i => {
                    const p = getProduct(i.productId);
                    const c = getCustomer(i.customerId);
                    const q = search.toLowerCase();
                    return !q || i.serialNo.toLowerCase().includes(q) || p?.name.toLowerCase().includes(q) || c?.name.toLowerCase().includes(q);
                  }).map((item, idx) => {
                    const p = getProduct(item.productId);
                    const c = getCustomer(item.customerId);
                    return (
                      <tr key={item.id} style={{ borderBottom: "1px solid #f5f5f5", background: idx % 2 === 0 ? "#fff" : "#fafbff" }}>
                        <td style={{ padding: "13px 16px", fontFamily: "monospace", fontWeight: 700, fontSize: 13, color: "#6382ff" }}>{item.serialNo}</td>
                        <td style={{ padding: "13px 16px", fontWeight: 600 }}>{p?.name}<div style={{ fontSize: 11, color: "#aaa", fontWeight: 400 }}>{p?.code}</div></td>
                        <td style={{ padding: "13px 16px" }}><Badge status={item.status} /></td>
                        <td style={{ padding: "13px 16px", color: c ? "#333" : "#ccc" }}>{c?.name || "—"}</td>
                        <td style={{ padding: "13px 16px", color: "#666" }}>{item.soldDate || "—"}</td>
                        <td style={{ padding: "13px 16px", color: item.status === "Warranty Expiring" ? "#e65100" : "#666", fontWeight: item.status === "Warranty Expiring" ? 700 : 400 }}>{item.extended ? item.extendedEnd : (item.warrantyEnd || "—")}</td>
                        <td style={{ padding: "13px 16px" }}>{item.extended ? <span style={{ color: "#22c55e", fontWeight: 700, fontSize: 12 }}>✓ Extended</span> : <span style={{ color: "#ccc", fontSize: 12 }}>—</span>}</td>
                        <td style={{ padding: "13px 16px", color: "#888", fontSize: 13 }}>{item.notes || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ══ PRODUCTS ══ */}
        {tab === "products" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
              <div>
                <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>Products</h1>
                <p style={{ color: "#888", margin: "4px 0 0", fontSize: 14 }}>Your product catalogue with pricing and specs</p>
              </div>
              <button style={{ display: "flex", alignItems: "center", gap: 8, background: "#1a1a2e", color: "#fff", border: "none", borderRadius: 10, padding: "10px 18px", cursor: "pointer", fontWeight: 700, fontSize: 14 }}>
                <Icon name="plus" size={16} /> Add Product
              </button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 16 }}>
              {products.map(p => {
                const units = inventory.filter(i => i.productId === p.id);
                const sold = units.filter(i => i.status === "Sold").length;
                const instock = units.filter(i => i.status === "In Stock").length;
                return (
                  <div key={p.id} style={{ background: "#fff", borderRadius: 16, padding: 24, border: "1px solid #f0f0f0", boxShadow: "0 2px 12px rgba(0,0,0,0.04)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
                      <div>
                        <div style={{ fontFamily: "monospace", fontSize: 11, color: "#aaa", marginBottom: 4 }}>{p.code}</div>
                        <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.3px" }}>{p.name}</div>
                        <div style={{ fontSize: 13, color: "#888", marginTop: 3 }}>{p.category}</div>
                      </div>
                      <div style={{ fontSize: 22, fontWeight: 800, color: "#6382ff" }}>${p.price}</div>
                    </div>

                    <div style={{ background: "#f7f8fc", borderRadius: 10, padding: "10px 14px", marginBottom: 14, fontSize: 13, color: "#555" }}>
                      📋 {p.specs}
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                      {[
                        { label: "In Stock", value: instock, color: "#22c55e" },
                        { label: "Sold", value: sold, color: "#6382ff" },
                        { label: "Warranty", value: `${p.warrantyMonths}mo`, color: "#f59e0b" },
                      ].map(stat => (
                        <div key={stat.label} style={{ textAlign: "center", padding: "10px 8px", background: stat.color + "12", borderRadius: 8 }}>
                          <div style={{ fontSize: 20, fontWeight: 800, color: stat.color }}>{stat.value}</div>
                          <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>{stat.label}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ══ CUSTOMERS ══ */}
        {tab === "customers" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
              <div>
                <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>Customers</h1>
                <p style={{ color: "#888", margin: "4px 0 0", fontSize: 14 }}>Your CRM — purchase history, contact info, warranty records</p>
              </div>
              <button style={{ display: "flex", alignItems: "center", gap: 8, background: "#1a1a2e", color: "#fff", border: "none", borderRadius: 10, padding: "10px 18px", cursor: "pointer", fontWeight: 700, fontSize: 14 }}>
                <Icon name="plus" size={16} /> Add Customer
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {customers.map(c => {
                const custInvoices = invoices.filter(i => i.customerId === c.id);
                const custInventory = inventory.filter(i => i.customerId === c.id);
                const total = custInvoices.reduce((s, i) => s + i.total, 0);
                return (
                  <div key={c.id} style={{ background: "#fff", borderRadius: 16, padding: 24, border: "1px solid #f0f0f0", boxShadow: "0 2px 12px rgba(0,0,0,0.04)", display: "flex", alignItems: "center", gap: 20 }}>
                    <div style={{ width: 52, height: 52, borderRadius: "50%", background: "linear-gradient(135deg,#6382ff,#a78bfa)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, fontWeight: 800, color: "#fff", flexShrink: 0 }}>
                      {c.name[0]}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                        <span style={{ fontSize: 17, fontWeight: 800 }}>{c.name}</span>
                        <Badge status={c.type} />
                      </div>
                      <div style={{ fontSize: 13, color: "#666" }}>{c.company} · {c.email} · {c.phone}</div>
                      <div style={{ fontSize: 12, color: "#aaa", marginTop: 2 }}>{c.address}</div>
                    </div>
                    <div style={{ display: "flex", gap: 16, textAlign: "center" }}>
                      <div style={{ padding: "8px 16px", background: "#f0f4ff", borderRadius: 10 }}>
                        <div style={{ fontSize: 18, fontWeight: 800, color: "#6382ff" }}>${total}</div>
                        <div style={{ fontSize: 11, color: "#888" }}>Lifetime value</div>
                      </div>
                      <div style={{ padding: "8px 16px", background: "#f0fdf4", borderRadius: 10 }}>
                        <div style={{ fontSize: 18, fontWeight: 800, color: "#22c55e" }}>{custInventory.length}</div>
                        <div style={{ fontSize: 11, color: "#888" }}>Products owned</div>
                      </div>
                      <div style={{ padding: "8px 16px", background: "#fff8f0", borderRadius: 10 }}>
                        <div style={{ fontSize: 18, fontWeight: 800, color: "#f59e0b" }}>{custInvoices.length}</div>
                        <div style={{ fontSize: 11, color: "#888" }}>Invoices</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ══ INVOICES ══ */}
        {tab === "invoices" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
              <div>
                <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>Invoices</h1>
                <p style={{ color: "#888", margin: "4px 0 0", fontSize: 14 }}>Create and manage all your invoices</p>
              </div>
              <button onClick={() => setShowNewInvoice(true)} style={{ display: "flex", alignItems: "center", gap: 8, background: "#6382ff", color: "#fff", border: "none", borderRadius: 10, padding: "10px 18px", cursor: "pointer", fontWeight: 700, fontSize: 14 }}>
                <Icon name="plus" size={16} /> New Invoice
              </button>
            </div>

            {/* New Invoice Modal */}
            {showNewInvoice && (
              <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
                <div style={{ background: "#fff", borderRadius: 20, padding: 32, width: 560, maxHeight: "85vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
                  {invoiceGenerated ? (
                    <div style={{ textAlign: "center", padding: "40px 20px" }}>
                      <div style={{ width: 72, height: 72, borderRadius: "50%", background: "#e8f5e9", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px", color: "#22c55e" }}>
                        <Icon name="check" size={36} />
                      </div>
                      <div style={{ fontSize: 22, fontWeight: 800, color: "#1a1a2e" }}>Invoice Generated!</div>
                      <div style={{ color: "#888", marginTop: 8, fontSize: 14 }}>PDF created & inventory updated automatically</div>
                    </div>
                  ) : (
                    <>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
                        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>New Invoice</h2>
                        <button onClick={() => setShowNewInvoice(false)} style={{ background: "#f5f5f5", border: "none", borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontSize: 13 }}>✕ Cancel</button>
                      </div>

                      <div style={{ marginBottom: 16 }}>
                        <label style={{ fontSize: 13, fontWeight: 700, color: "#555", display: "block", marginBottom: 6 }}>Customer</label>
                        <select value={newInvoice.customerId} onChange={e => setNewInvoice({ ...newInvoice, customerId: e.target.value })} style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid #e0e0e0", fontSize: 14, outline: "none" }}>
                          <option value="">Select customer...</option>
                          {customers.map(c => <option key={c.id} value={c.id}>{c.name} — {c.company}</option>)}
                        </select>
                      </div>

                      <div style={{ marginBottom: 16 }}>
                        <label style={{ fontSize: 13, fontWeight: 700, color: "#555", display: "block", marginBottom: 8 }}>Products</label>
                        {newInvoice.items.map((item, idx) => (
                          <div key={idx} style={{ display: "flex", gap: 10, marginBottom: 8 }}>
                            <select value={item.productId} onChange={e => {
                              const items = [...newInvoice.items];
                              items[idx].productId = e.target.value;
                              setNewInvoice({ ...newInvoice, items });
                            }} style={{ flex: 2, padding: "10px 14px", borderRadius: 10, border: "1px solid #e0e0e0", fontSize: 14, outline: "none" }}>
                              <option value="">Select product...</option>
                              {products.map(p => <option key={p.id} value={p.id}>{p.name} — ${p.price}</option>)}
                            </select>
                            <input type="number" min="1" value={item.qty} onChange={e => {
                              const items = [...newInvoice.items];
                              items[idx].qty = parseInt(e.target.value) || 1;
                              setNewInvoice({ ...newInvoice, items });
                            }} style={{ flex: 0.5, padding: "10px 14px", borderRadius: 10, border: "1px solid #e0e0e0", fontSize: 14, outline: "none", textAlign: "center" }} />
                            <div style={{ flex: 0.7, display: "flex", alignItems: "center", fontWeight: 700, color: "#6382ff", fontSize: 15 }}>
                              ${(getProduct(item.productId)?.price || 0) * item.qty}
                            </div>
                          </div>
                        ))}
                        <button onClick={() => setNewInvoice({ ...newInvoice, items: [...newInvoice.items, { productId: "", qty: 1 }] })} style={{ fontSize: 13, color: "#6382ff", background: "none", border: "1px dashed #6382ff", borderRadius: 8, padding: "8px 16px", cursor: "pointer", width: "100%", marginTop: 4 }}>
                          + Add another product
                        </button>
                      </div>

                      <div style={{ marginBottom: 16 }}>
                        <label style={{ fontSize: 13, fontWeight: 700, color: "#555", display: "block", marginBottom: 6 }}>Notes</label>
                        <input value={newInvoice.notes} onChange={e => setNewInvoice({ ...newInvoice, notes: e.target.value })} placeholder="e.g. Shopify Order #1055, WhatsApp order..." style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid #e0e0e0", fontSize: 14, outline: "none", boxSizing: "border-box" }} />
                      </div>

                      <div style={{ marginBottom: 24, display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", background: "#f0f4ff", borderRadius: 12 }}>
                        <input type="checkbox" id="warranty" checked={newInvoice.warranty} onChange={e => setNewInvoice({ ...newInvoice, warranty: e.target.checked })} style={{ width: 16, height: 16, cursor: "pointer" }} />
                        <label htmlFor="warranty" style={{ fontSize: 14, cursor: "pointer", fontWeight: 600 }}>Customer wants extended warranty (+1 year)</label>
                      </div>

                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 20px", background: "#1a1a2e", borderRadius: 12, marginBottom: 16 }}>
                        <span style={{ color: "#aaa", fontSize: 14 }}>Total</span>
                        <span style={{ color: "#fff", fontSize: 24, fontWeight: 800 }}>${invoiceTotal.toLocaleString()}</span>
                      </div>

                      <button onClick={handleGenerateInvoice} disabled={!newInvoice.customerId || invoiceTotal === 0} style={{ width: "100%", padding: "14px", background: newInvoice.customerId && invoiceTotal > 0 ? "#6382ff" : "#e0e0e0", color: "#fff", border: "none", borderRadius: 12, fontSize: 16, fontWeight: 800, cursor: newInvoice.customerId && invoiceTotal > 0 ? "pointer" : "not-allowed" }}>
                        Generate Invoice & Update Inventory
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Invoice List */}
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {invoices.map(inv => {
                const c = getCustomer(inv.customerId);
                return (
                  <div key={inv.id} style={{ background: "#fff", borderRadius: 14, padding: "20px 24px", border: "1px solid #f0f0f0", boxShadow: "0 2px 8px rgba(0,0,0,0.03)", display: "flex", alignItems: "center", gap: 20 }}>
                    <div style={{ width: 44, height: 44, borderRadius: 12, background: "#f0f4ff", display: "flex", alignItems: "center", justifyContent: "center", color: "#6382ff" }}>
                      <Icon name="invoice" size={20} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 800, fontSize: 15 }}>{inv.id}</div>
                      <div style={{ fontSize: 13, color: "#888", marginTop: 2 }}>{c?.name} · {inv.date} · {inv.notes}</div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                      <div>
                        {inv.items.map((item, i) => {
                          const p = getProduct(item.productId);
                          return <div key={i} style={{ fontSize: 12, color: "#888" }}>{p?.name} ×{item.qty}</div>;
                        })}
                      </div>
                      <div style={{ fontSize: 20, fontWeight: 800, color: "#1a1a2e", minWidth: 80, textAlign: "right" }}>${inv.total}</div>
                      <Badge status={inv.status} />
                      <button style={{ fontSize: 12, background: "#f0f4ff", color: "#6382ff", border: "none", borderRadius: 8, padding: "7px 14px", cursor: "pointer", fontWeight: 700 }}>PDF ↓</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
