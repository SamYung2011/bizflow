import React, { useState, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabaseClient.js'
import { isNonWarrantyItem } from '../lib/warranty.js'
import { useAppContext } from '../context/AppContext.jsx'
import { useT } from '../i18n.jsx'
import { Icon } from '../components/Icon.jsx'
import ShopifySettingsPanel from '../components/ShopifySettingsPanel.jsx'

// LOW_STOCK_THRESHOLD 已搬到 AppContext（lowStockSkus 也已在那裡計算）

export const emptyNewProduct = () => ({
  name: '', category: '', internal_code: '', price: '',
  warranty_months: 12, specs: '',
  image_file: null, image_preview: '',
  has_variants: false,
  variants: [],
  is_virtual: false,
})

export function ProductEditModal({
  editingProduct, setEditingProduct,
  editStocks, setEditStocks,
  editProductPrice, setEditProductPrice,
  editProductWarranty, setEditProductWarranty,
}) {
  const { t } = useT()
  const { products, setProducts, warehouses, stocks, setStocks, invoices, setInvoices } = useAppContext()
  const queryClient = useQueryClient()
  if (!editingProduct) return null
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
      <div style={{ background: "#fff", borderRadius: 20, padding: 32, width: 440, boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>{t("修改產品")}</h2>
          <button onClick={() => setEditingProduct(null)} style={{ background: "#f5f5f5", border: "none", borderRadius: 8, padding: "6px 10px", cursor: "pointer" }}><Icon name="x" size={16} /></button>
        </div>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>{editingProduct.name}</div>
        <div style={{ fontFamily: "monospace", fontSize: 11, color: "#aaa", marginBottom: 20 }}>{editingProduct.internal_code}</div>
        {/* 價格 */}
        <div style={{ marginBottom: 14, display: "flex", alignItems: "center", gap: 12 }}>
          <label style={{ fontSize: 13, fontWeight: 700, color: "#555", minWidth: 80 }}>{t("價格")} HK$</label>
          <input type="number" min="0" step="0.01" value={editProductPrice}
            onChange={e => setEditProductPrice(e.target.value)}
            style={{ flex: 1, padding: "10px 14px", borderRadius: 10, border: "1px solid #e0e0e0", fontSize: 16, fontWeight: 700, outline: "none", textAlign: "center" }} />
        </div>
        {/* 保修月數 */}
        <div style={{ marginBottom: 14, display: "flex", alignItems: "center", gap: 12 }}>
          <label style={{ fontSize: 13, fontWeight: 700, color: "#555", minWidth: 80 }}>{t("保修")}（{t("月")}）</label>
          <input type="number" min="0" value={editProductWarranty}
            onChange={e => setEditProductWarranty(e.target.value)}
            style={{ flex: 1, padding: "10px 14px", borderRadius: 10, border: "1px solid #e0e0e0", fontSize: 16, fontWeight: 700, outline: "none", textAlign: "center" }} />
        </div>
        {/* 倉庫 */}
        <div style={{ fontSize: 11, color: "#888", marginBottom: 8, marginTop: 8, fontWeight: 700 }}>{t("各倉庫存")}</div>
        {warehouses.map(w => (
          <div key={w.id} style={{ marginBottom: 14, display: "flex", alignItems: "center", gap: 12 }}>
            <label style={{ fontSize: 13, fontWeight: 700, color: "#555", minWidth: 80 }}>{t(w.name)}</label>
            <input type="number" min="0" value={editStocks[w.id] ?? 0}
              onChange={e => setEditStocks(s => ({ ...s, [w.id]: parseInt(e.target.value) || 0 }))}
              style={{ flex: 1, padding: "10px 14px", borderRadius: 10, border: "1px solid #e0e0e0", fontSize: 16, fontWeight: 700, outline: "none", textAlign: "center" }} />
          </div>
        ))}
        <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
          <button onClick={() => setEditingProduct(null)} style={{ flex: 1, padding: 12, background: "#f5f5f5", color: "#666", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: "pointer" }}>{t("取消")}</button>
          <button onClick={async () => {
            const newPrice = editProductPrice === "" ? null : Number(editProductPrice);
            const newWarranty = editProductWarranty === "" ? null : parseInt(editProductWarranty, 10);
            const productPatch = {};
            const oldWarranty = editingProduct.warranty_months ?? null;
            if (Number(editingProduct.price ?? 0) !== Number(newPrice ?? 0)) productPatch.price = newPrice;
            if (oldWarranty !== newWarranty) productPatch.warranty_months = newWarranty;
            // 保修月數有變 → 凍結老訂單裡未 snapshot 的 line item 用舊值
            if ('warranty_months' in productPatch && oldWarranty != null) {
              const targetName = editingProduct.name;
              const dirtyInvoices = [];
              for (const inv of invoices) {
                if (!Array.isArray(inv.items)) continue;
                let dirty = false;
                const newItems = inv.items.map(it => {
                  if (it?.name === targetName && it?.warranty_months == null && !isNonWarrantyItem(it.name)) {
                    dirty = true;
                    return { ...it, warranty_months: oldWarranty };
                  }
                  return it;
                });
                if (dirty) dirtyInvoices.push({ id: inv.id, items: newItems });
              }
              for (const u of dirtyInvoices) {
                const { error: invErr } = await supabase.from("invoices").update({ items: u.items }).eq("id", u.id);
                if (invErr) { alert(`${t("凍結舊訂單保修失敗")}：${invErr.message}`); return; }
              }
              if (dirtyInvoices.length > 0) {
                const idMap = new Map(dirtyInvoices.map(u => [u.id, u.items]));
                setInvoices(prev => prev.map(i => idMap.has(i.id) ? { ...i, items: idMap.get(i.id) } : i));
                queryClient.setQueryData(["bf", "invoices"], (old) => Array.isArray(old) ? old.map(i => idMap.has(i.id) ? { ...i, items: idMap.get(i.id) } : i) : old);
              }
            }
            if (Object.keys(productPatch).length > 0) {
              const { error: pErr } = await supabase.from("products").update(productPatch).eq("id", editingProduct.id);
              if (pErr) { alert(`${t("產品儲存失敗")}：${pErr.message}`); return; }
              setProducts(prev => prev.map(x => x.id === editingProduct.id ? { ...x, ...productPatch } : x));
              queryClient.setQueryData(["bf", "products"], (old) => Array.isArray(old) ? old.map(x => x.id === editingProduct.id ? { ...x, ...productPatch } : x) : old);
            }
            // 庫存差異
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
            if (upserts.length > 0) {
              const { error: upErr } = await supabase.from("inventory_stock").upsert(upserts, { onConflict: "product_id,warehouse_id" });
              if (upErr) { alert(`${t("庫存儲存失敗")}：${upErr.message}`); return; }
              if (movements.length > 0) await supabase.from("inventory_movements").insert(movements);
              setStocks(prev => {
                const map = new Map(prev.map(s => [`${s.product_id}_${s.warehouse_id}`, s]));
                for (const u of upserts) {
                  const k = `${u.product_id}_${u.warehouse_id}`;
                  const old = map.get(k);
                  map.set(k, { ...(old || { id: crypto.randomUUID() }), ...u });
                }
                return [...map.values()];
              });
            }
            setEditingProduct(null);
          }} style={{ flex: 1, padding: 12, background: "#6382ff", color: "#fff", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: "pointer" }}>{t("儲存")}</button>
        </div>
      </div>
    </div>
  )
}

export function ProductNewModal({
  newProductOpen, setNewProductOpen,
  newProduct, setNewProduct,
  newProductSaving, setNewProductSaving,
}) {
  const { t } = useT()
  const { products, setProducts } = useAppContext()
  if (!newProductOpen) return null
  const np = newProduct;
  const CATEGORY_PREFIX = { '轉插': 'ADP', '充電線': 'CBL', '便攜充電': 'PTC', '充電樁': 'CHG', '停售': 'DSC' };
  const codePrefix = (cat) => CATEGORY_PREFIX[(cat || '').trim()] || 'PRD';
  const nextParentCode = (cat) => {
    const prefix = codePrefix(cat);
    const re = new RegExp('^' + prefix + '-(\\d{4})(?:-\\d+)?$');
    let max = 0;
    for (const p of products) {
      const m = (p.internal_code || '').match(re);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    return prefix + '-' + String(max + 1).padStart(4, '0');
  };
  const nextChildCode = (parentCode, variants) => {
    if (!parentCode) return '';
    const re = new RegExp('^' + parentCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '-(\\d+)$');
    let max = 0;
    for (const v of variants) {
      const m = (v.internal_code || '').match(re);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    return parentCode + '-' + String(max + 1).padStart(2, '0');
  };
  const reChildSuffix = /-(\d+)$/;
  const setNp = (patch) => setNewProduct(prev => ({ ...prev, ...patch }));
  const setCategory = (cat) => setNewProduct(prev => ({ ...prev, category: cat, internal_code: nextParentCode(cat) }));
  const setParentCode = (code) => setNewProduct(prev => ({
    ...prev,
    internal_code: code,
    variants: prev.variants.map(v => {
      const m = (v.internal_code || '').match(reChildSuffix);
      return m ? { ...v, internal_code: code + m[0] } : v;
    }),
  }));
  const setVariant = (idx, patch) => setNewProduct(prev => ({
    ...prev,
    variants: prev.variants.map((v, i) => i === idx ? { ...v, ...patch } : v),
  }));
  const addVariant = () => setNewProduct(prev => ({
    ...prev,
    variants: [...prev.variants, { name: "", price: "", internal_code: nextChildCode(prev.internal_code, prev.variants), specs: "", warranty_months: prev.warranty_months || 12 }],
  }));
  const removeVariant = (idx) => setNewProduct(prev => ({
    ...prev,
    variants: prev.variants.filter((_, i) => i !== idx),
  }));
  const existingCats = [...new Set(products.filter(p => !p.parent_product_id && p.category && p.category !== '_archived').map(p => p.category))];
  const close = () => { setNewProductOpen(false); setNewProduct(emptyNewProduct()); };
  const onPickImage = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => setNp({ image_file: file, image_preview: e.target.result });
    reader.readAsDataURL(file);
  };
  const handleCreate = async () => {
    if (!np.image_file) { alert(t("請上傳產品圖片")); return; }
    if (!np.name.trim()) { alert(t("請輸入產品名稱")); return; }
    if (np.has_variants) {
      if (np.variants.length === 0) { alert(t("子型號至少需要一行")); return; }
      for (const [i, v] of np.variants.entries()) {
        if (!v.name.trim()) { alert(`${t("子型號")} #${i + 1} ${t("缺少名稱")}`); return; }
        if (v.price === "" || isNaN(Number(v.price))) { alert(`${t("子型號")} #${i + 1} ${t("缺少價格")}`); return; }
      }
    } else {
      if (np.price === "" || isNaN(Number(np.price))) { alert(t("請填寫價格")); return; }
    }
    setNewProductSaving(true);
    try {
      const ext = (np.image_file.name.split('.').pop() || 'jpg').toLowerCase();
      const folder = (np.internal_code || np.name).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40) || 'new';
      const path = `${folder}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from('product-images').upload(path, np.image_file, { upsert: false });
      if (upErr) throw new Error(t("圖片上傳失敗") + "：" + upErr.message);
      const { data: pub } = supabase.storage.from('product-images').getPublicUrl(path);
      const imageUrl = pub.publicUrl;

      const parentRow = {
        name: np.name.trim(),
        price: np.has_variants ? 0 : Number(np.price),
        stock: 0,
        warranty_months: Number(np.warranty_months) || null,
        category: np.category.trim() || null,
        internal_code: np.internal_code.trim() || null,
        specs: np.specs.trim() || null,
        image_url: imageUrl,
        status: 'active',
        is_virtual: np.is_virtual === true,
      };
      const { data: inserted, error: insErr } = await supabase.from('products').insert(parentRow).select().single();
      if (insErr) throw new Error(t("建立產品失敗") + "：" + insErr.message);

      let allInserted = [inserted];
      if (np.has_variants) {
        const childRows = np.variants.map(v => ({
          name: v.name.trim(),
          price: Number(v.price),
          stock: 0,
          warranty_months: Number(v.warranty_months) || Number(np.warranty_months) || null,
          category: np.category.trim() || null,
          internal_code: v.internal_code.trim() || null,
          specs: v.specs.trim() || null,
          image_url: imageUrl,
          status: 'active',
          is_virtual: np.is_virtual === true,
          parent_product_id: inserted.id,
        }));
        const { data: childInserted, error: childErr } = await supabase.from('products').insert(childRows).select();
        if (childErr) throw new Error(t("建立子型號失敗") + "：" + childErr.message);
        allInserted = [inserted, ...(childInserted || [])];
      }
      setProducts(prev => [...prev, ...allInserted]);
      close();
    } catch (e) {
      alert(e.message || String(e));
    } finally {
      setNewProductSaving(false);
    }
  };
  const inputStyle = { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #e0e0e0", fontSize: 14, outline: "none", boxSizing: "border-box" };
  const labelStyle = { fontSize: 12, fontWeight: 700, color: "#555", display: "block", marginBottom: 6 };
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20 }}>
      <div style={{ background: "#fff", borderRadius: 20, width: 640, maxWidth: "100%", maxHeight: "90vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 24px", borderBottom: "1px solid #f0f0f0" }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>{t("新增產品")}</h2>
          <button onClick={close} style={{ background: "#f5f5f5", border: "none", borderRadius: 8, padding: "6px 10px", cursor: "pointer" }}><Icon name="x" size={16} /></button>
        </div>
        <div style={{ padding: 24, overflowY: "auto", flex: 1 }}>
          {/* 圖片 */}
          <div style={{ marginBottom: 20 }}>
            <label style={labelStyle}>{t("產品圖片")} <span style={{ color: "#ef4444" }}>*</span></label>
            {np.image_preview ? (
              <div style={{ position: "relative", display: "inline-block" }}>
                <img src={np.image_preview} style={{ width: 180, height: 180, objectFit: "cover", borderRadius: 10, border: "1px solid #f0f0f0" }} />
                <button onClick={() => setNp({ image_file: null, image_preview: "" })} style={{ position: "absolute", top: 6, right: 6, background: "rgba(0,0,0,0.6)", color: "#fff", border: "none", borderRadius: 6, padding: "4px 8px", cursor: "pointer", fontSize: 12 }}>{t("移除")}</button>
              </div>
            ) : (
              <label style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", width: 180, height: 180, border: "2px dashed #d0d5dd", borderRadius: 10, cursor: "pointer", background: "#fafbfc", color: "#888" }}>
                <div style={{ fontSize: 32, marginBottom: 4 }}>+</div>
                <div style={{ fontSize: 12 }}>{t("點擊上傳圖片")}</div>
                <input type="file" accept="image/*" style={{ display: "none" }} onChange={e => onPickImage(e.target.files?.[0])} />
              </label>
            )}
          </div>

          {/* 基本信息 */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
            <div>
              <label style={labelStyle}>{t("產品名稱")} <span style={{ color: "#ef4444" }}>*</span></label>
              <input value={np.name} onChange={e => setNp({ name: e.target.value })} placeholder={t("例如：Type2 便携式充電器")} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>{t("類別")}</label>
              <input list="np-cat-list" value={np.category} onChange={e => setCategory(e.target.value)} placeholder={t("選擇或輸入新類別")} style={inputStyle} />
              <datalist id="np-cat-list">
                {existingCats.map(c => <option key={c} value={c} />)}
              </datalist>
              <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, fontSize: 12, color: "#666", cursor: "pointer" }}>
                <input type="checkbox" checked={np.is_virtual === true} onChange={e => setNp({ is_virtual: e.target.checked })} style={{ cursor: "pointer" }} />
                {t("虛擬產品（押金/手續費等不入庫存預警）")}
              </label>
            </div>
            <div>
              <label style={labelStyle}>{t("內部編號")} <span style={{ color: "#aaa", fontWeight: 400 }}>· {t("自動生成")}</span></label>
              <input value={np.internal_code} onChange={e => setParentCode(e.target.value)} placeholder="PRD-0001" style={{ ...inputStyle, fontFamily: "monospace" }} />
            </div>
            <div>
              <label style={labelStyle}>{t("保修月數")}</label>
              <input type="number" min="0" value={np.warranty_months} onChange={e => setNp({ warranty_months: e.target.value })} style={inputStyle} />
            </div>
            {!np.has_variants && (
              <div>
                <label style={labelStyle}>{t("價格")} (HK$) <span style={{ color: "#ef4444" }}>*</span></label>
                <input type="number" min="0" value={np.price} onChange={e => setNp({ price: e.target.value })} placeholder="0" style={inputStyle} />
              </div>
            )}
            <div style={{ gridColumn: np.has_variants ? "span 2" : "auto" }}>
              <label style={labelStyle}>{t("規格")}</label>
              <textarea value={np.specs} onChange={e => setNp({ specs: e.target.value })} rows={2} placeholder={t("可選")} style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }} />
            </div>
          </div>

          {/* 子型號 */}
          <div style={{ marginTop: 8, padding: 14, background: "#fafbfc", borderRadius: 10, border: "1px solid #f0f0f0" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 14, fontWeight: 700 }}>
              <input type="checkbox" checked={np.has_variants} onChange={e => {
                const checked = e.target.checked;
                setNewProduct(prev => ({
                  ...prev,
                  has_variants: checked,
                  variants: checked && prev.variants.length === 0
                    ? [{ name: "", price: "", internal_code: nextChildCode(prev.internal_code, []), specs: "", warranty_months: prev.warranty_months || 12 }]
                    : prev.variants,
                }));
              }} />
              {t("有其他型號（子型號）")}
            </label>
            {np.has_variants && (
              <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
                {np.variants.map((v, idx) => (
                  <div key={idx} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1.2fr 36px", gap: 8, alignItems: "center", padding: 10, background: "#fff", borderRadius: 8, border: "1px solid #f0f0f0" }}>
                    <input value={v.name} onChange={e => setVariant(idx, { name: e.target.value })} placeholder={t("子型號名稱") + " *"} style={inputStyle} />
                    <input type="number" min="0" value={v.price} onChange={e => setVariant(idx, { price: e.target.value })} placeholder={t("價格") + " *"} style={inputStyle} />
                    <input value={v.internal_code} onChange={e => setVariant(idx, { internal_code: e.target.value })} placeholder={t("內部編號")} style={{ ...inputStyle, fontFamily: "monospace" }} />
                    <button onClick={() => removeVariant(idx)} title={t("刪除")} style={{ background: "#fef2f2", color: "#ef4444", border: "none", borderRadius: 8, height: 38, cursor: "pointer", fontSize: 16, fontWeight: 700 }}>×</button>
                  </div>
                ))}
                <button onClick={addVariant} style={{ alignSelf: "flex-start", background: "#fff", color: "#6382ff", border: "1px dashed #6382ff", borderRadius: 8, padding: "8px 14px", cursor: "pointer", fontSize: 13, fontWeight: 700 }}>
                  + {t("添加子型號")}
                </button>
              </div>
            )}
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, padding: "16px 24px", borderTop: "1px solid #f0f0f0" }}>
          <button onClick={close} disabled={newProductSaving} style={{ flex: 1, padding: 12, background: "#f5f5f5", color: "#666", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: newProductSaving ? "not-allowed" : "pointer" }}>{t("取消")}</button>
          <button onClick={handleCreate} disabled={newProductSaving} style={{ flex: 2, padding: 12, background: newProductSaving ? "#a8b8e8" : "#6382ff", color: "#fff", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: newProductSaving ? "not-allowed" : "pointer" }}>
            {newProductSaving ? t("建立中...") : t("建立產品")}
          </button>
        </div>
      </div>
    </div>
  )
}

export function ProductsListView({
  setSelectedProduct,
  setEditingProduct,
  setNewProduct, setNewProductOpen,
  search, setSearch,
}) {
  const { t } = useT()
  const { products, warehouses, stocks, lineItemAliases, setLineItemAliases, invoices, lowStockSkus } = useAppContext()
  const queryClient = useQueryClient()

  const [productsSubTab, setProductsSubTab] = useState('list')
  const [productCategoryFilter, setProductCategoryFilter] = useState('')
  const [editingAlias, setEditingAlias] = useState(null)
  const [aliasSaving, setAliasSaving] = useState(false)
  const [expandedAliasGroups, setExpandedAliasGroups] = useState(() => new Set())

  // lowStockSkus 已搬到 AppContext（dashboard 也用同份）

  async function handleSaveAlias(draft) {
    if (!draft.alias_name || !draft.alias_name.trim()) { alert(t("alias_name 不能為空")); return }
    setAliasSaving(true)
    try {
      const payload = {
        alias_name: draft.alias_name.trim(),
        skip: draft.skip === true,
        products: draft.skip === true ? [] : (Array.isArray(draft.products) ? draft.products.filter(p => p.product_id && Number(p.qty) > 0) : []),
        note: (draft.note || "").trim() || null,
        verified: true,
        updated_at: new Date().toISOString(),
      }
      if (draft.id) {
        const { data, error } = await supabase.from("line_item_aliases").update(payload).eq("id", draft.id).select().single()
        if (error) throw error
        setLineItemAliases(prev => prev.map(a => a.id === draft.id ? data : a))
        queryClient.setQueryData(["bf", "line_item_aliases"], (old) => Array.isArray(old) ? old.map(a => a.id === draft.id ? data : a) : old)
      } else {
        const { data, error } = await supabase.from("line_item_aliases").insert(payload).select().single()
        if (error) throw error
        setLineItemAliases(prev => [...prev, data])
        queryClient.setQueryData(["bf", "line_item_aliases"], (old) => Array.isArray(old) ? [...old, data] : [data])
      }
      setEditingAlias(null)
    } catch (e) {
      alert(`${t("保存失敗")}：${e.message}`)
    } finally {
      setAliasSaving(false)
    }
  }

  async function handleDeleteAlias(aliasId) {
    if (!window.confirm(t("確定刪除此映射？"))) return
    const { error } = await supabase.from("line_item_aliases").delete().eq("id", aliasId)
    if (error) { alert(`${t("刪除失敗")}：${error.message}`); return }
    setLineItemAliases(prev => prev.filter(a => a.id !== aliasId))
    queryClient.setQueryData(["bf", "line_item_aliases"], (old) => Array.isArray(old) ? old.filter(a => a.id !== aliasId) : old)
  }

  async function handleVerifyAlias(aliasId) {
    const { data, error } = await supabase.from("line_item_aliases").update({ verified: true, updated_at: new Date().toISOString() }).eq("id", aliasId).select().single()
    if (error) { alert(`${t("確認失敗")}：${error.message}`); return }
    setLineItemAliases(prev => prev.map(a => a.id === aliasId ? data : a))
    queryClient.setQueryData(["bf", "line_item_aliases"], (old) => Array.isArray(old) ? old.map(a => a.id === aliasId ? data : a) : old)
  }

  return (
    <>
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>{t("產品")}</h1>
            <p style={{ color: "#888", margin: "4px 0 0", fontSize: 14 }}>{t("產品目錄 + 庫存管理")}</p>
          </div>
          <button
            onClick={() => {
              const init = emptyNewProduct();
              const re = /^PRD-(\d{4})(?:-\d+)?$/;
              let max = 0;
              for (const p of products) {
                const m = (p.internal_code || '').match(re);
                if (m) max = Math.max(max, parseInt(m[1], 10));
              }
              init.internal_code = `PRD-${String(max + 1).padStart(4, '0')}`;
              setNewProduct(init);
              setNewProductOpen(true);
            }}
            style={{ background: "#6382ff", color: "#fff", border: "none", borderRadius: 10, padding: "10px 18px", cursor: "pointer", fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 18, lineHeight: 1 }}>+</span> {t("新增產品")}
          </button>
        </div>
        {/* 子 tab：產品列表 / Line Item 映射 */}
        <div style={{ display: "flex", gap: 4, marginBottom: 16, borderBottom: "1px solid #eef0fa" }}>
          {[["list", t("產品列表")], ["aliases", t("Line Item 映射")], ["shopify", t("Shopify API")]].map(([k, label]) => {
            const on = productsSubTab === k;
            return (
              <button key={k} onClick={() => setProductsSubTab(k)} style={{ padding: "8px 16px", background: "transparent", border: "none", borderBottom: on ? "2px solid #6382ff" : "2px solid transparent", color: on ? "#3b58d4" : "#888", fontSize: 13, fontWeight: 700, cursor: "pointer", marginBottom: -1 }}>{label}</button>
            );
          })}
        </div>
        {productsSubTab === "list" && (<>
        <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #f0f0f0", padding: "10px 14px", marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
          <Icon name="search" size={15} />
          <input placeholder={t("搜尋和篩選...")} value={search} onChange={e => setSearch(e.target.value)} style={{ border: "none", background: "none", outline: "none", fontSize: 14, width: "100%" }} />
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
          {(() => {
            const cats = [...new Set(products.filter(p => !p.parent_product_id && p.category !== '_archived').map(p => p.category).filter(Boolean))];
            const all = [["", t("全部")], ...cats.map(c => [c, c])];
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
            <div>{t("圖片")}</div>
            <div>{t("商品")}</div>
            <div>{t("狀態")}</div>
            <div>{t("庫存")}</div>
            <div>{t("類別")}</div>
            <div style={{ textAlign: "right" }}>{t("價格")}</div>
          </div>
          {products.filter(p => {
            if (p.parent_product_id) return false;
            if (p.category === '_archived') return false;
            if (productCategoryFilter && p.category !== productCategoryFilter) return false;
            const q = search.toLowerCase();
            return !q || (p.name || "").toLowerCase().includes(q) || (p.internal_code || "").toLowerCase().includes(q) || (p.category || "").toLowerCase().includes(q) || (p.specs || "").toLowerCase().includes(q);
          }).map(p => {
            const children = products.filter(c => c.parent_product_id === p.id);
            const hasChildren = children.length > 0;
            const status = p.status || "active";
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
                  <div style={{ width: 48, height: 48, background: "#f0f2f5", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", color: "#bbb", fontSize: 10 }}>{t("圖")}</div>
                )}
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#1a1a1a" }}>{p.name}</div>
                  <div style={{ fontFamily: "monospace", fontSize: 10, color: "#aaa", marginTop: 2 }}>{p.internal_code || p.code || p.id.slice(0, 8)}</div>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  <span style={{ padding: "3px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600, background: status === "draft" ? "#e5e7eb" : status === "discontinued" ? "#fee2e2" : "#d1fae5", color: status === "draft" ? "#6b7280" : status === "discontinued" ? "#991b1b" : "#047857" }}>
                    {status === "draft" ? t("草稿") : status === "discontinued" ? t("停售") : t("啟用")}
                  </span>
                  {p.is_virtual === true && (
                    <span style={{ padding: "3px 8px", borderRadius: 6, fontSize: 11, fontWeight: 600, background: "#e0e7ff", color: "#3b58d4" }}>{t("虛擬")}</span>
                  )}
                  {p.is_virtual !== true && status !== "discontinued" && (() => {
                    const targetIds = hasChildren ? children.map(c => c.id) : [p.id];
                    const isLow = lowStockSkus.some(x => targetIds.includes(x.id));
                    return isLow ? <span style={{ padding: "3px 8px", borderRadius: 6, fontSize: 11, fontWeight: 700, background: "#fef3c7", color: "#92400e" }}>⚠ {t("低庫存")}</span> : null;
                  })()}
                </div>
                <div onClick={hasChildren ? undefined : (e) => { e.stopPropagation(); setEditingProduct(p); }} style={{ cursor: hasChildren ? "default" : "pointer" }}>
                  {hasChildren && <div style={{ fontSize: 11, color: "#888", marginBottom: 2 }}>{t("共")} {children.length} {t("個子類")} · {t("共")} {totalStock} {t("件")}</div>}
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    {stockByWarehouse.map(({ warehouse, qty }) => (
                      <span key={warehouse.id} style={{ fontSize: 12 }}>
                        <span style={{ color: "#888" }}>{t(warehouse.name.replace("分部", ""))}</span>
                        <span style={{ color: qty > 0 ? "#22c55e" : "#ef4444", fontWeight: 700, marginLeft: 4 }}>{qty}</span>
                      </span>
                    ))}
                    {!hasChildren && <span style={{ fontSize: 11, color: "#bbb" }}>✏️</span>}
                  </div>
                </div>
                <div style={{ color: "#555" }}>{p.category || t("未分類")}</div>
                <div style={{ textAlign: "right", fontWeight: 700, color: "#1a1a1a" }}>{priceDisplay}</div>
              </div>
            );
          })}
          {products.length === 0 && (
            <div style={{ padding: 40, textAlign: "center", color: "#aaa" }}>{t("暫無產品")}</div>
          )}
        </div>
        </>)}
        {productsSubTab === "aliases" && (() => {
          const known = new Set(lineItemAliases.map(a => (a.alias_name || "").toLowerCase().trim()));
          const productNames = new Set(products.map(p => (p.name || "").toLowerCase().trim()));
          const unmatched = new Map();
          for (const inv of invoices) {
            if (inv.legacy_skip_deduct === true) continue;
            let arr = inv.items;
            if (typeof arr === "string") { try { arr = JSON.parse(arr); } catch { arr = []; } }
            if (!Array.isArray(arr)) continue;
            for (const it of arr) {
              const nm = (it.name || "").trim();
              const k = nm.toLowerCase();
              if (!nm) continue;
              if (known.has(k)) continue;
              if (productNames.has(k)) continue;
              unmatched.set(nm, (unmatched.get(nm) || 0) + 1);
            }
          }
          const unmatchedSorted = [...unmatched.entries()].sort((a, b) => b[1] - a[1]);
          const productById = new Map(products.map(p => [p.id, p]));
          const productLabel = (id) => productById.get(id)?.name || "?";
          return (
            <div>
              {/* 未匹配 items */}
              <div style={{ background: "#fff8e1", border: "1px solid #ffe082", borderRadius: 12, padding: 16, marginBottom: 20 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#8a6900", marginBottom: 10 }}>
                  ⚠ {t("未匹配的 line item")} <span style={{ fontSize: 12, color: "#b88a00", marginLeft: 6 }}>{unmatchedSorted.length}</span>
                </div>
                {unmatchedSorted.length === 0 ? (
                  <div style={{ fontSize: 12, color: "#b8a76a", fontStyle: "italic" }}>{t("全部 line item 都已配映射 ✓")}</div>
                ) : (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 60px 100px", gap: 8, alignItems: "center" }}>
                    {unmatchedSorted.slice(0, 50).map(([nm, cnt]) => (
                      <React.Fragment key={nm}>
                        <div style={{ fontSize: 13, color: "#333" }}>{nm}</div>
                        <div style={{ fontSize: 11, color: "#888", textAlign: "right" }}>{cnt} {t("次")}</div>
                        <button onClick={() => setEditingAlias({ alias_name: nm, skip: false, products: [{ product_id: "", qty: 1 }], note: "" })} style={{ padding: "4px 10px", background: "#6382ff", color: "#fff", border: "none", borderRadius: 6, fontSize: 11, cursor: "pointer" }}>+ {t("配映射")}</button>
                      </React.Fragment>
                    ))}
                    {unmatchedSorted.length > 50 && <div style={{ gridColumn: "1 / -1", fontSize: 11, color: "#888", textAlign: "center", paddingTop: 6 }}>{t("還有")} {unmatchedSorted.length - 50} {t("條未顯示")}</div>}
                  </div>
                )}
              </div>
              {/* 已建 aliases 列表 */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{t("已配映射")} <span style={{ color: "#888", fontWeight: 400 }}>{lineItemAliases.length}</span></div>
                <button onClick={() => setEditingAlias({ alias_name: "", skip: false, products: [{ product_id: "", qty: 1 }], note: "" })} style={{ padding: "6px 14px", background: "#6382ff", color: "#fff", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>+ {t("新增映射")}</button>
              </div>
              <div>
                {lineItemAliases.length === 0 ? (
                  <div style={{ background: "#fff", border: "1px solid #f0f0f0", borderRadius: 12, padding: 40, textAlign: "center", color: "#aaa", fontSize: 13 }}>{t("暫無映射，從上方未匹配列表點「配映射」開始")}</div>
                ) : (() => {
                  const productGroups = new Map();
                  const bundleGroup = { key: "__bundle__", label: t("套裝"), items: [], color: "#6382ff", bg: "#eef2ff" };
                  const skipGroup = { key: "__skip__", label: t("不扣（押金 / 運費 / Final Payment / 租務 等）"), items: [], color: "#991b1b", bg: "#fee2e2" };
                  const noProdGroup = { key: "__noprod__", label: t("未配產品（需處理）"), items: [], color: "#b45309", bg: "#fef3c7" };
                  for (const a of lineItemAliases) {
                    if (a.skip === true) { skipGroup.items.push(a); continue; }
                    const ps = Array.isArray(a.products) ? a.products : [];
                    if (ps.length === 0) { noProdGroup.items.push(a); continue; }
                    if (ps.length >= 2) { bundleGroup.items.push(a); continue; }
                    const pid = ps[0].product_id;
                    const prod = productById.get(pid);
                    if (!productGroups.has(pid)) productGroups.set(pid, { key: pid, label: prod?.name || t("已刪除產品"), items: [], productId: pid, color: "#047857", bg: "#d1fae5" });
                    productGroups.get(pid).items.push(a);
                  }
                  const allGroups = [
                    ...[...productGroups.values()].sort((x, y) => y.items.length - x.items.length || x.label.localeCompare(y.label)),
                    ...(bundleGroup.items.length > 0 ? [bundleGroup] : []),
                    ...(skipGroup.items.length > 0 ? [skipGroup] : []),
                    ...(noProdGroup.items.length > 0 ? [noProdGroup] : []),
                  ];
                  const toggleGroup = (k) => setExpandedAliasGroups(prev => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; });
                  return (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {allGroups.map(g => {
                        const expanded = expandedAliasGroups.has(g.key);
                        const unverifiedCount = g.items.filter(a => a.verified !== true).length;
                        return (
                          <div key={g.key} style={{ background: "#fff", border: "1px solid #f0f0f0", borderRadius: 12, overflow: "hidden" }}>
                            <div onClick={() => toggleGroup(g.key)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", background: g.bg, cursor: "pointer", borderBottom: expanded ? "1px solid " + g.bg : "none" }}>
                              <span style={{ fontSize: 11, color: g.color }}>{expanded ? "▼" : "▶"}</span>
                              <span style={{ fontSize: 14, fontWeight: 700, color: g.color, flex: 1 }}>{g.label}</span>
                              {unverifiedCount > 0 && <span style={{ fontSize: 10, fontWeight: 700, color: "#b45309", background: "#fef3c7", padding: "2px 8px", borderRadius: 6 }}>⚠ {unverifiedCount} {t("待校對")}</span>}
                              <span style={{ fontSize: 12, color: g.color, fontWeight: 600 }}>{g.items.length} {t("條")}</span>
                            </div>
                            {expanded && (
                              <div>
                                {[...g.items].sort((a, b) => (a.verified === b.verified ? (a.alias_name || "").localeCompare(b.alias_name || "") : (a.verified ? 1 : -1))).map(a => {
                                  const isUnverified = a.verified !== true;
                                  return (
                                    <div key={a.id} style={{ display: "grid", gridTemplateColumns: "2fr 1.5fr 140px", gap: 12, padding: "10px 16px", borderBottom: "1px solid #f5f5f5", alignItems: "center", fontSize: 13, background: isUnverified ? "#fffbeb" : "transparent" }}>
                                      <div>
                                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                          <span style={{ fontWeight: 600 }}>{a.alias_name}</span>
                                          {isUnverified && <span style={{ fontSize: 9, fontWeight: 700, color: "#b45309", background: "#fef3c7", padding: "1px 6px", borderRadius: 4 }}>⚠ {t("待校對")}</span>}
                                        </div>
                                        {a.skip !== true && Array.isArray(a.products) && a.products.length >= 2 && (
                                          <div style={{ fontSize: 11, color: "#666", marginTop: 3 }}>→ {a.products.map(p => `${productLabel(p.product_id)}×${p.qty || 1}`).join(" + ")}</div>
                                        )}
                                      </div>
                                      <div style={{ fontSize: 11, color: "#888" }}>{a.note || ""}</div>
                                      <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                                        {isUnverified && <button onClick={() => handleVerifyAlias(a.id)} title={t("一鍵確認此映射正確")} style={{ padding: "4px 8px", background: "#d1fae5", color: "#047857", border: "none", borderRadius: 6, fontSize: 11, cursor: "pointer", fontWeight: 700 }}>✓ {t("確認")}</button>}
                                        <button onClick={() => setEditingAlias({ id: a.id, alias_name: a.alias_name, skip: a.skip, products: Array.isArray(a.products) && a.products.length > 0 ? a.products : [{ product_id: "", qty: 1 }], note: a.note || "" })} style={{ padding: "4px 8px", background: "#eef2ff", color: "#3b58d4", border: "none", borderRadius: 6, fontSize: 11, cursor: "pointer" }}>✏️</button>
                                        <button onClick={() => handleDeleteAlias(a.id)} style={{ padding: "4px 8px", background: "#fce4ec", color: "#e53935", border: "none", borderRadius: 6, fontSize: 11, cursor: "pointer" }}>×</button>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            </div>
          );
        })()}
        {productsSubTab === "shopify" && <ShopifySettingsPanel />}
      </div>

      {/* 編輯/新增映射 modal */}
      {editingAlias && (() => {
        const draft = editingAlias;
        const isNew = !draft.id;
        const setDraft = (patch) => setEditingAlias(prev => ({ ...prev, ...patch }));
        const setProduct = (idx, patch) => setEditingAlias(prev => ({ ...prev, products: prev.products.map((p, i) => i === idx ? { ...p, ...patch } : p) }));
        const addRow = () => setEditingAlias(prev => ({ ...prev, products: [...prev.products, { product_id: "", qty: 1 }] }));
        const removeRow = (idx) => setEditingAlias(prev => ({ ...prev, products: prev.products.filter((_, i) => i !== idx) }));
        const selectableProducts = products.filter(p => p.category !== '_archived').sort((a, b) => (a.name || "").localeCompare(b.name || ""));
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20 }}>
            <div style={{ background: "#fff", borderRadius: 16, width: 560, maxWidth: "100%", maxHeight: "90vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 22px", borderBottom: "1px solid #f0f0f0" }}>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>{isNew ? t("新增 Line Item 映射") : t("編輯映射")}</h2>
                <button onClick={() => setEditingAlias(null)} style={{ background: "#f5f5f5", border: "none", borderRadius: 8, padding: "6px 10px", cursor: "pointer" }}>×</button>
              </div>
              <div style={{ padding: 22, overflowY: "auto", flex: 1 }}>
                <div style={{ marginBottom: 14 }}>
                  <label style={{ fontSize: 12, fontWeight: 700, color: "#555", display: "block", marginBottom: 6 }}>alias_name <span style={{ color: "#ef4444" }}>*</span></label>
                  <input value={draft.alias_name} onChange={e => setDraft({ alias_name: e.target.value })} disabled={!isNew} placeholder={t("發票 items 裡的原始名字")} style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid #e0e0e0", fontSize: 14, outline: "none", boxSizing: "border-box", background: isNew ? "#fff" : "#f5f5f5", color: isNew ? "#222" : "#888" }} />
                  {!isNew && <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>{t("已存在的 alias 不可改名（避免破壞已建關聯）")}</div>}
                </div>
                <div style={{ marginBottom: 14 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
                    <input type="checkbox" checked={draft.skip === true} onChange={e => setDraft({ skip: e.target.checked })} />
                    {t("此 alias 不扣庫存（押金 / 運費 / Final Payment / 租務 等）")}
                  </label>
                </div>
                {draft.skip !== true && (
                  <div style={{ marginBottom: 14 }}>
                    <label style={{ fontSize: 12, fontWeight: 700, color: "#555", display: "block", marginBottom: 8 }}>{t("映射到產品")} <span style={{ fontSize: 11, color: "#888", fontWeight: 400 }}>· {t("套裝可加多行")}</span></label>
                    {draft.products.map((row, idx) => (
                      <div key={idx} style={{ display: "grid", gridTemplateColumns: "1fr 70px 30px", gap: 8, marginBottom: 6 }}>
                        <select value={row.product_id} onChange={e => setProduct(idx, { product_id: e.target.value })} style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #e0e0e0", fontSize: 13, outline: "none", background: "#fff" }}>
                          <option value="">{t("選擇產品...")}</option>
                          {selectableProducts.map(p => (
                            <option key={p.id} value={p.id}>{p.name}{p.parent_product_id ? "" : ""}</option>
                          ))}
                        </select>
                        <input type="number" min="1" value={row.qty} onChange={e => setProduct(idx, { qty: Number(e.target.value) || 1 })} placeholder="qty" style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #e0e0e0", fontSize: 13, outline: "none", textAlign: "center" }} />
                        <button onClick={() => removeRow(idx)} disabled={draft.products.length === 1} style={{ background: draft.products.length === 1 ? "#f5f5f5" : "#fce4ec", color: draft.products.length === 1 ? "#ccc" : "#e53935", border: "none", borderRadius: 8, fontSize: 14, cursor: draft.products.length === 1 ? "not-allowed" : "pointer" }}>×</button>
                      </div>
                    ))}
                    <button onClick={addRow} style={{ padding: "6px 12px", background: "#fafbff", border: "1px dashed #c6d3ff", color: "#6382ff", borderRadius: 8, fontSize: 12, cursor: "pointer", marginTop: 4 }}>+ {t("加一行")}</button>
                  </div>
                )}
                <div style={{ marginBottom: 14 }}>
                  <label style={{ fontSize: 12, fontWeight: 700, color: "#555", display: "block", marginBottom: 6 }}>{t("備註（可選）")}</label>
                  <input value={draft.note || ""} onChange={e => setDraft({ note: e.target.value })} placeholder={t("例如：DC 二代首付 / Final Payment / 套裝")} style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid #e0e0e0", fontSize: 13, outline: "none", boxSizing: "border-box" }} />
                </div>
              </div>
              <div style={{ display: "flex", gap: 10, padding: "14px 22px", borderTop: "1px solid #f0f0f0" }}>
                <button onClick={() => setEditingAlias(null)} style={{ flex: 1, padding: 10, background: "#f5f5f5", color: "#666", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: "pointer" }}>{t("取消")}</button>
                <button onClick={() => handleSaveAlias(draft)} disabled={aliasSaving} style={{ flex: 2, padding: 10, background: aliasSaving ? "#a0aec0" : "#6382ff", color: "#fff", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 800, cursor: aliasSaving ? "not-allowed" : "pointer" }}>{aliasSaving ? t("保存中...") : t("保存")}</button>
              </div>
            </div>
          </div>
        );
      })()}
    </>
  )
}

export function ProductsDetailView({ selectedProduct, setSelectedProduct, setEditingProduct }) {
  const { t } = useT()
  const { products, setProducts, customers, warehouses, stocks, setStocks, invoices, lineItemAliases, isBfAdmin } = useAppContext()
  const queryClient = useQueryClient()
  const [productOrgDraft, setProductOrgDraft] = useState(null)
  const [expandedSkuGroups, setExpandedSkuGroups] = useState(() => new Set())

  // 庫存變動歷史（按 SKU 拉 inventory_movements，含 children）
  const [movements, setMovements] = useState([])
  const [movementsLoading, setMovementsLoading] = useState(false)
  const [movementsLimit, setMovementsLimit] = useState(20)
  useEffect(() => {
    if (!selectedProduct) { setMovements([]); return }
    setMovementsLoading(true)
    const childIds = products.filter(c => c.parent_product_id === selectedProduct.id).map(c => c.id)
    const pids = [selectedProduct.id, ...childIds]
    supabase
      .from('inventory_movements')
      .select('*')
      .in('product_id', pids)
      .order('created_at', { ascending: false })
      .limit(200)
      .then(({ data, error }) => {
        if (!error) setMovements(data || [])
        setMovementsLoading(false)
      })
    setMovementsLimit(20)
  }, [selectedProduct?.id, products])

          const p = selectedProduct;
          const children = products.filter(c => c.parent_product_id === p.id);
          const hasChildren = children.length > 0;
          const pids = hasChildren ? children.map(c => c.id) : [p.id];
          const allPids = [p.id, ...children.map(c => c.id)];
          // 12 月每月聚合 + 90 天總覽 + 趨勢預測
          // 走 line_item_aliases 映射查產品 UUID。alias/mapping 改了實時生效（每次 render 重算）
          const today = new Date();
          const targetPidSet = new Set(allPids);
          const normName = (s) => (s || "").toLowerCase().trim();
          const aliasByName = new Map(lineItemAliases.map(a => [normName(a.alias_name), a]));
          const productByName = new Map(products.map(pp => [pp.name, pp]));
          // 過去 12 個月（以本月為最後一格）
          const monthlyStats = []; // [{ym, qty, revenue}]
          for (let i = 11; i >= 0; i--) {
            const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
            const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            monthlyStats.push({ ym, label: `${d.getMonth() + 1}月`, qty: 0, revenue: 0 });
          }
          const monthByYm = new Map(monthlyStats.map(m => [m.ym, m]));
          const buyers = new Set();
          let soldQty = 0, soldTotal = 0;
          const since90 = new Date(today); since90.setDate(since90.getDate() - 90);
          for (const inv of invoices) {
            if (!Array.isArray(inv.items) || !inv.date) continue;
            if ((inv.status || "").toLowerCase() !== "paid") continue;
            const invDate = new Date(inv.date);
            const ym = (inv.date || "").slice(0, 7);
            const monthBucket = monthByYm.get(ym);
            const within90 = invDate >= since90;
            if (!monthBucket && !within90) continue;
            let invMatched = false;
            for (const it of inv.items) {
              if (!it || !it.name) continue;
              const itemQty = Number(it.qty) || 1;
              const itemPrice = Number(it.price) || 0;
              const lineValue = itemPrice * itemQty;
              const alias = aliasByName.get(normName(it.name));
              let matchedQty = 0;
              let matchedShare = 0;
              if (alias && alias.skip !== true && Array.isArray(alias.products) && alias.products.length > 0) {
                const totalMult = alias.products.reduce((s, x) => s + (Number(x.qty) || 1), 0);
                for (const ap of alias.products) {
                  if (targetPidSet.has(ap.product_id)) {
                    const m = Number(ap.qty) || 1;
                    matchedQty += m * itemQty;
                    matchedShare += m / totalMult;
                  }
                }
              } else if (!alias) {
                const directProd = productByName.get(it.name);
                if (directProd && targetPidSet.has(directProd.id)) {
                  matchedQty += itemQty;
                  matchedShare = 1;
                }
              }
              if (matchedQty > 0) {
                if (monthBucket) {
                  monthBucket.qty += matchedQty;
                  monthBucket.revenue += lineValue * matchedShare;
                }
                if (within90) {
                  soldQty += matchedQty;
                  soldTotal += lineValue * matchedShare;
                  invMatched = true;
                }
              }
            }
            if (invMatched && inv.customer_id) buyers.add(inv.customer_id);
          }
          // 三檔均量：跳過當月（partial month，會稀釋均值），只用完整月份
          // 例如今天 2026-05-08：完整月份 = ... 2026-04，最近 6 月 = [2025-11..2026-04]
          // 預測基礎用 6 月均（穩定，不被單一波動月帶偏），趨勢比 = 最近 6 月 vs 前 6 月
          const sumQ = (arr) => arr.reduce((s, m) => s + m.qty, 0);
          const sumR = (arr) => arr.reduce((s, m) => s + m.revenue, 0);
          const completeMonths = monthlyStats.slice(0, -1); // 砍掉當月（最後一格 partial）
          const last3  = completeMonths.slice(-3);           // 最近 3 個完整月（僅作展示）
          const last6  = completeMonths.slice(-6);           // 最近 6 個完整月（baseline）
          const prev6  = completeMonths.slice(-12, -6);      // 6-12 月前 6 個月（用作趨勢對比）
          const last12 = completeMonths.slice(-12);          // 最近 12 個完整月
          const avg3Qty  = last3.length  > 0 ? sumQ(last3)  / last3.length  : 0;
          const avg6Qty  = last6.length  > 0 ? sumQ(last6)  / last6.length  : 0;
          const avg12Qty = last12.length > 0 ? sumQ(last12) / last12.length : 0;
          const avg6Rev  = last6.length  > 0 ? sumR(last6)  / last6.length  : 0;
          const prev6Qty = prev6.length  > 0 ? sumQ(prev6)  / prev6.length  : 0;
          const prev6Rev = prev6.length  > 0 ? sumR(prev6)  / prev6.length  : 0;
          // 趨勢：最近 6 月均 vs 前 6 月均（6-12 月前）— 比 3 月窗口穩定
          const growthQty = prev6Qty > 0 ? (avg6Qty - prev6Qty) / prev6Qty : (avg6Qty > 0 ? 1 : 0);
          const growthRev = prev6Rev > 0 ? (avg6Rev - prev6Rev) / prev6Rev : (avg6Rev > 0 ? 1 : 0);
          // 趨勢標識
          const labelTrend = (g) => {
            if (g >= 0.2)   return { icon: '↑', text: '上升', color: '#22c55e', bg: '#dcfce7' };
            if (g >= 0.05)  return { icon: '↗', text: '略升', color: '#84cc16', bg: '#ecfccb' };
            if (g <= -0.2)  return { icon: '↓', text: '下滑', color: '#ef4444', bg: '#fee2e2' };
            if (g <= -0.05) return { icon: '↘', text: '略降', color: '#f59e0b', bg: '#fef3c7' };
            return { icon: '→', text: '持平', color: '#888',   bg: '#f5f5f5' };
          };
          const trendQty = labelTrend(growthQty);
          // 下月預測：最近 6 月均 + 半權重趨勢外推（baseline 改 6 月，更穩定）
          const forecastQty = Math.max(0, avg6Qty * (1 + growthQty * 0.5));
          const forecastRev = Math.max(0, avg6Rev * (1 + growthRev * 0.5));
          // 信心度：用最近 6 完整月波動係數（標準差/均值）粗判
          const recent6Qtys = last6.map(m => m.qty);
          const meanQ = recent6Qtys.reduce((s, q) => s + q, 0) / Math.max(1, recent6Qtys.length);
          const variance = recent6Qtys.reduce((s, q) => s + (q - meanQ) ** 2, 0) / Math.max(1, recent6Qtys.length);
          const stdQ = Math.sqrt(variance);
          const cv = meanQ > 0 ? stdQ / meanQ : 0; // coefficient of variation
          const confidence = cv < 0.3 ? '高' : cv < 0.6 ? '中' : '低';
          const maxMonthQty = Math.max(1, ...monthlyStats.map(m => m.qty));
          // 組織分類编辑
          const draft = productOrgDraft || { product_type: p.product_type || "", collections: p.collections || [], tags: p.tags || [] };
          const saveDraft = async () => {
            const { error } = await supabase.from("products").update({ product_type: draft.product_type || null, collections: draft.collections, tags: draft.tags }).eq("id", p.id);
            if (error) { alert(t("儲存失敗：") + error.message); return; }
            setProducts(prev => prev.map(x => x.id === p.id ? { ...x, ...draft } : x));
            setSelectedProduct(prev => ({ ...prev, ...draft }));
            setProductOrgDraft(null);
          };
          const collectionOpts = [...new Set(products.flatMap(x => x.collections || []))].filter(Boolean);
          const tagOpts = [...new Set(products.flatMap(x => x.tags || []))].filter(Boolean);
          const isDiscontinued = (p.status || "active") === "discontinued";
          const isVirtual = p.is_virtual === true;
          const toggleStatus = async () => {
            const next = isDiscontinued ? "active" : "discontinued";
            const ids = [p.id, ...children.map(c => c.id)];
            const { error } = await supabase.from("products").update({ status: next }).in("id", ids);
            if (error) { alert((isDiscontinued ? t("啟用失敗") : t("停售失敗")) + "：" + error.message); return; }
            setProducts(prev => prev.map(x => ids.includes(x.id) ? { ...x, status: next } : x));
            setSelectedProduct(prev => ({ ...prev, status: next }));
          };
          const toggleVirtual = async () => {
            const next = !isVirtual;
            const ids = [p.id, ...children.map(c => c.id)];
            const { error } = await supabase.from("products").update({ is_virtual: next }).in("id", ids);
            if (error) { alert(t("儲存失敗：") + error.message); return; }
            setProducts(prev => prev.map(x => ids.includes(x.id) ? { ...x, is_virtual: next } : x));
            setSelectedProduct(prev => ({ ...prev, is_virtual: next }));
          };
          const deleteProduct = async () => {
            const childCount = children.length;
            const msg = childCount > 0
              ? `${t("確定刪除")}「${p.name}」？\n${t("會一併刪除")} ${childCount} ${t("個子型號")}，${t("此操作不可恢復")}。`
              : `${t("確定刪除")}「${p.name}」？\n${t("此操作不可恢復")}。`;
            if (!confirm(msg)) return;
            const ids = [p.id, ...children.map(c => c.id)];
            await supabase.from("inventory_stock").delete().in("product_id", ids);
            await supabase.from("inventory_movements").delete().in("product_id", ids);
            const { error } = await supabase.from("products").delete().eq("id", p.id);
            if (error) { alert(t("刪除失敗") + "：" + error.message); return; }
            setProducts(prev => prev.filter(x => !ids.includes(x.id)));
            setSelectedProduct(null);
            setProductOrgDraft(null);
          };
          return (
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
                <button onClick={() => { setSelectedProduct(null); setProductOrgDraft(null); }} style={{ background: "#f5f5f5", border: "none", borderRadius: 10, padding: "10px 14px", cursor: "pointer", fontSize: 14 }}>{t("← 返回")}</button>
                <div style={{ flex: 1 }}>
                  {isBfAdmin ? (
                    <input
                      defaultValue={p.name || ""}
                      key={p.id}
                      onBlur={async (e) => {
                        const v = (e.target.value || "").trim();
                        if (!v || v === p.name) return;
                        const { error } = await supabase.from("products").update({ name: v }).eq("id", p.id);
                        if (error) { alert(`${t("保存失敗")}：${error.message}`); e.target.value = p.name; return; }
                        setProducts(prev => prev.map(x => x.id === p.id ? { ...x, name: v } : x));
                        setSelectedProduct(prev => ({ ...prev, name: v }));
                        queryClient.setQueryData(["bf", "products"], (old) => Array.isArray(old) ? old.map(x => x.id === p.id ? { ...x, name: v } : x) : old);
                      }}
                      style={{ fontSize: 24, fontWeight: 800, border: "1px solid transparent", outline: "none", background: "transparent", padding: "2px 6px", borderRadius: 6, fontFamily: "inherit", width: "100%", boxSizing: "border-box" }}
                      onFocus={e => { e.target.style.border = "1px solid #6382ff"; e.target.style.background = "#fff"; }}
                      onBlurCapture={e => { e.target.style.border = "1px solid transparent"; e.target.style.background = "transparent"; }}
                      title={t("點擊編輯產品名稱")}
                    />
                  ) : (
                    <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>{p.name}</h1>
                  )}
                  <div style={{ fontFamily: "monospace", fontSize: 12, color: "#aaa", marginTop: 4, paddingLeft: isBfAdmin ? 6 : 0 }}>{p.internal_code}</div>
                </div>
                <button onClick={toggleVirtual} title={t("虛擬產品（押金/手續費等不入庫存預警）")} style={{ background: isVirtual ? "#e0e7ff" : "#f5f5f5", color: isVirtual ? "#3b58d4" : "#666", border: "none", borderRadius: 10, padding: "10px 16px", cursor: "pointer", fontSize: 14, fontWeight: 700 }}>
                  {isVirtual ? `✓ ${t("虛擬")}` : t("標為虛擬")}
                </button>
                <button onClick={toggleStatus} style={{ background: isDiscontinued ? "#d1fae5" : "#fef3c7", color: isDiscontinued ? "#047857" : "#92400e", border: "none", borderRadius: 10, padding: "10px 16px", cursor: "pointer", fontSize: 14, fontWeight: 700 }}>
                  {isDiscontinued ? t("啟用") : t("停售")}
                </button>
                <button onClick={deleteProduct} style={{ background: "#fef2f2", color: "#ef4444", border: "none", borderRadius: 10, padding: "10px 16px", cursor: "pointer", fontSize: 14, fontWeight: 700 }}>
                  {t("刪除")}
                </button>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 20 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  {/* 產品圖片 */}
                  <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #f0f0f0", padding: 20 }}>
                    <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 14 }}>{t("產品圖片")}</div>
                    {p.image_url ? (
                      <img src={p.image_url} style={{ width: "100%", maxHeight: 320, objectFit: "contain", borderRadius: 10, background: "#fafbfc", border: "1px solid #f0f0f0" }} />
                    ) : (
                      <div style={{ width: "100%", height: 200, background: "#f7f9fc", borderRadius: 10, border: "1px dashed #e0e0e0", display: "flex", alignItems: "center", justifyContent: "center", color: "#bbb", fontSize: 14 }}>{t("尚無圖片")}</div>
                    )}
                    <label style={{ display: "inline-block", marginTop: 12, padding: "8px 16px", background: "#6382ff", color: "#fff", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 700 }}>
                      {p.image_url ? t("替換圖片") : t("上傳圖片")}
                      <input type="file" accept="image/*" style={{ display: "none" }} onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
                        const path = `${p.internal_code || p.id}/${Date.now()}.${ext}`;
                        const { error: upErr } = await supabase.storage.from('product-images').upload(path, file, { upsert: false });
                        if (upErr) { alert(t('上傳失敗：') + upErr.message); return; }
                        const { data: pub } = supabase.storage.from('product-images').getPublicUrl(path);
                        const url = pub.publicUrl;
                        const { error: dbErr } = await supabase.from('products').update({ image_url: url }).eq('id', p.id);
                        if (dbErr) { alert(t('保存失敗：') + dbErr.message); return; }
                        setProducts(prev => prev.map(x => x.id === p.id ? { ...x, image_url: url } : x));
                        setSelectedProduct(prev => ({ ...prev, image_url: url }));
                      }} />
                    </label>
                    {p.image_url && (
                      <button onClick={async () => {
                        if (!confirm(t('確定移除這張圖片？'))) return;
                        const { error } = await supabase.from('products').update({ image_url: null }).eq('id', p.id);
                        if (error) { alert(t('移除失敗：') + error.message); return; }
                        setProducts(prev => prev.map(x => x.id === p.id ? { ...x, image_url: null } : x));
                        setSelectedProduct(prev => ({ ...prev, image_url: null }));
                      }} style={{ marginLeft: 8, padding: "8px 16px", background: "#f5f5f5", color: "#666", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13 }}>{t("移除")}</button>
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
                          <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 14 }}>{t("子類")} · {t("共")} {children.length} {t("個")}（{t("按規格分組")}）</div>
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
                                        <div style={{ fontSize: 14, fontWeight: 700 }}>{t("Type2 充電樁")} {key}</div>
                                        <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>{allInGroup.length} {t("個 SKU")} · {t("共")} {groupStock} {t("件")}</div>
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
                                            <th style={{ textAlign: "left", padding: "6px 10px", color: "#888", fontWeight: 600, borderBottom: "1px solid #e8eaed" }}>{t("線長")}</th>
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
                                                          <span style={{ color: "#888" }}>{t(w.name.replace("分部", ""))}</span>
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
                        <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 14 }}>{t("子類")} · {t("共")} {children.length} {t("個")}</div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                          {children.map(c => {
                            const cStockByW = warehouses.map(w => ({ w, qty: stocks.filter(s => s.product_id === c.id && s.warehouse_id === w.id).reduce((sum, s) => sum + (s.qty || 0), 0) }));
                            return (
                              <div key={c.id} style={{ display: "grid", gridTemplateColumns: "48px 2fr 1.2fr 1fr 40px", gap: 12, alignItems: "center", padding: "10px 12px", borderRadius: 8, border: "1px solid #f0f0f0" }}>
                                {c.image_url ? (
                                  <img src={c.image_url} style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 6, border: "1px solid #f0f0f0" }} />
                                ) : (
                                  <div style={{ width: 40, height: 40, background: "#f0f2f5", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", color: "#bbb", fontSize: 9 }}>{t("圖")}</div>
                                )}
                                <div>
                                  <div style={{ fontSize: 13, fontWeight: 600 }}>{c.name}</div>
                                  <div style={{ fontFamily: "monospace", fontSize: 10, color: "#aaa" }}>{c.internal_code}</div>
                                </div>
                                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 12 }}>
                                  {cStockByW.map(({ w, qty }) => (
                                    <span key={w.id}>
                                      <span style={{ color: "#888" }}>{t(w.name.replace("分部", ""))}</span>
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
                      <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 14 }}>{t("分倉庫存")}</div>
                      {warehouses.map(w => {
                        const qty = stocks.filter(s => s.product_id === p.id && s.warehouse_id === w.id).reduce((sum, s) => sum + (s.qty || 0), 0);
                        return (
                          <div key={w.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #f5f5f5" }}>
                            <span>{t(w.name)}</span>
                            <span style={{ color: qty > 0 ? "#22c55e" : "#ef4444", fontWeight: 700 }}>{qty} {t("件")}</span>
                          </div>
                        );
                      })}
                      <button onClick={() => setEditingProduct(p)} style={{ marginTop: 12, background: "#6382ff", color: "#fff", border: "none", borderRadius: 8, padding: "8px 14px", cursor: "pointer", fontSize: 13, fontWeight: 700 }}>{t("修改產品")}</button>
                    </div>
                  )}
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  {/* 銷量趨勢 + 下月預測 */}
                  <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #f0f0f0", padding: 20 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                      <div style={{ fontSize: 14, fontWeight: 800 }}>{t("銷量趨勢")}</div>
                      <span style={{ fontSize: 11, padding: "3px 8px", borderRadius: 12, background: trendQty.bg, color: trendQty.color, fontWeight: 700 }}>
                        {trendQty.icon} {t(trendQty.text)} {growthQty !== 0 && `${growthQty > 0 ? '+' : ''}${Math.round(growthQty * 100)}%`}
                      </span>
                    </div>
                    {/* 12 月每月迷你 bar chart */}
                    <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 60, marginBottom: 8 }}>
                      {monthlyStats.map((m) => (
                        <div key={m.ym} title={`${m.ym}: ${Math.round(m.qty)} 件 · HK$${Math.round(m.revenue).toLocaleString()}`}
                          style={{ flex: 1, height: `${(m.qty / maxMonthQty) * 100}%`, minHeight: m.qty > 0 ? 2 : 0, background: "linear-gradient(180deg, #6382ff, #a78bfa)", borderRadius: "3px 3px 0 0", opacity: m.qty > 0 ? 1 : 0.15 }} />
                      ))}
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "#aaa", marginBottom: 14 }}>
                      <span>{monthlyStats[0]?.label}</span>
                      <span>{monthlyStats[monthlyStats.length - 1]?.label}</span>
                    </div>
                    {/* 三檔均量 */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 12, fontSize: 11 }}>
                      <div style={{ textAlign: "center", padding: "6px 4px", background: "#f8f9ff", borderRadius: 6 }}>
                        <div style={{ color: "#888", marginBottom: 2 }}>{t("12 月均")}</div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: "#333" }}>{Math.round(avg12Qty)} {t("件")}</div>
                      </div>
                      <div style={{ textAlign: "center", padding: "6px 4px", background: "#eef2ff", borderRadius: 6, border: "1px solid #d0dafe" }}>
                        <div style={{ color: "#3b58d4", marginBottom: 2, fontWeight: 700 }}>{t("6 月均")}</div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: "#3b58d4" }}>{Math.round(avg6Qty)} {t("件")}</div>
                      </div>
                      <div style={{ textAlign: "center", padding: "6px 4px", background: "#f8f9ff", borderRadius: 6 }}>
                        <div style={{ color: "#888", marginBottom: 2 }}>{t("3 月均")}</div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: "#333" }}>{Math.round(avg3Qty)} {t("件")}</div>
                      </div>
                    </div>
                    {/* 下月預測 */}
                    {avg3Qty > 0 && (
                      <div style={{ background: "#fff8e1", borderRadius: 8, padding: "10px 12px", marginBottom: 12, border: "1px solid #f4dca4" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                          <div style={{ fontSize: 11, color: "#8a6900", fontWeight: 700 }}>{t("下月預測")}</div>
                          <div style={{ fontSize: 9, color: "#888" }}>{t("信心度")}：<b style={{ color: confidence === '高' ? '#22c55e' : confidence === '中' ? '#f59e0b' : '#ef4444' }}>{t(confidence)}</b></div>
                        </div>
                        <div style={{ fontSize: 13, color: "#333" }}>
                          <b style={{ fontSize: 16, color: "#b87500" }}>{Math.round(forecastQty)}</b> {t("件")}
                          <span style={{ color: "#888", marginLeft: 8 }}>· HK${Math.round(forecastRev).toLocaleString()}</span>
                        </div>
                        <div style={{ fontSize: 9, color: "#a89060", marginTop: 4 }}>{t("基於最近 6 月趨勢外推")}</div>
                      </div>
                    )}
                    {/* 過去 90 天總覽（保留摘要） */}
                    <div style={{ borderTop: "1px dashed #eee", paddingTop: 10, fontSize: 12, color: "#888", lineHeight: 1.7 }}>
                      <div style={{ fontWeight: 700, color: "#555", marginBottom: 4 }}>{t("過去 90 天")}</div>
                      <div>• {t("售出")} <b style={{ color: "#555" }}>{Math.round(soldQty)}</b> {t("件")} · <b style={{ color: "#555" }}>{buyers.size}</b> {t("位買家")}</div>
                      <div>• {t("銷貨淨額")} <b style={{ color: "#555" }}>HK$ {Math.round(soldTotal).toLocaleString()}</b></div>
                    </div>
                  </div>
                  {/* 商品組織分類 */}
                  <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #f0f0f0", padding: 20 }}>
                    <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 14 }}>{t("商品組織分類")}</div>
                    <div style={{ marginBottom: 12 }}>
                      <label style={{ fontSize: 12, color: "#888", display: "block", marginBottom: 4 }}>{t("類型")}</label>
                      <input value={draft.product_type} onChange={e => setProductOrgDraft({ ...draft, product_type: e.target.value })} placeholder={t("如 EV / 配件")}
                        style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #e0e0e0", fontSize: 13, boxSizing: "border-box" }} />
                    </div>
                    <div style={{ marginBottom: 12 }}>
                      <label style={{ fontSize: 12, color: "#888", display: "block", marginBottom: 4 }}>{t("商品系列")}</label>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
                        {draft.collections.map((c, i) => (
                          <span key={i} style={{ background: "#f0f4ff", color: "#6382ff", padding: "4px 8px", borderRadius: 6, fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
                            {c}
                            <button onClick={() => setProductOrgDraft({ ...draft, collections: draft.collections.filter((_, j) => j !== i) })} style={{ background: "none", border: "none", cursor: "pointer", color: "#6382ff", padding: 0 }}>×</button>
                          </span>
                        ))}
                      </div>
                      <input placeholder={t("輸入後回車新增")} list="collection-opts" onKeyDown={e => {
                        if (e.key === "Enter" && e.target.value.trim()) {
                          const v = e.target.value.trim();
                          if (!draft.collections.includes(v)) setProductOrgDraft({ ...draft, collections: [...draft.collections, v] });
                          e.target.value = "";
                        }
                      }} style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #e0e0e0", fontSize: 13, boxSizing: "border-box" }} />
                      <datalist id="collection-opts">{collectionOpts.map(o => <option key={o} value={o} />)}</datalist>
                    </div>
                    <div style={{ marginBottom: 12 }}>
                      <label style={{ fontSize: 12, color: "#888", display: "block", marginBottom: 4 }}>{t("標籤")}</label>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
                        {draft.tags.map((t, i) => (
                          <span key={i} style={{ background: "#fff6e5", color: "#b87500", padding: "4px 8px", borderRadius: 6, fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
                            {t}
                            <button onClick={() => setProductOrgDraft({ ...draft, tags: draft.tags.filter((_, j) => j !== i) })} style={{ background: "none", border: "none", cursor: "pointer", color: "#b87500", padding: 0 }}>×</button>
                          </span>
                        ))}
                      </div>
                      <input placeholder={t("輸入後回車新增")} list="tag-opts" onKeyDown={e => {
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
                        <button onClick={() => setProductOrgDraft(null)} style={{ flex: 1, padding: "8px 10px", background: "#f5f5f5", border: "none", borderRadius: 8, fontSize: 13, cursor: "pointer" }}>{t("取消")}</button>
                        <button onClick={saveDraft} style={{ flex: 1, padding: "8px 10px", background: "#6382ff", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>{t("儲存")}</button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              {/* 庫存變動歷史 */}
              <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #f0f0f0", padding: 20, marginTop: 20 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                  <div style={{ fontSize: 14, fontWeight: 800 }}>{t("庫存變動歷史")}</div>
                  {!movementsLoading && movements.length > 0 && (
                    <div style={{ fontSize: 11, color: "#888" }}>{movements.length} {t("條記錄")}</div>
                  )}
                </div>
                {movementsLoading ? (
                  <div style={{ textAlign: "center", color: "#888", fontSize: 13, padding: 20 }}>{t("加載中")}…</div>
                ) : movements.length === 0 ? (
                  <div style={{ textAlign: "center", color: "#aaa", fontSize: 13, padding: 30 }}>{t("暫無變動記錄")}</div>
                ) : (
                  <>
                    <div style={{ display: "grid", gridTemplateColumns: "160px 90px 100px 80px 1fr 110px", gap: 12, padding: "10px 12px", background: "#fafbfc", borderRadius: 8, fontSize: 11, color: "#666", fontWeight: 600 }}>
                      <div>{t("時間")}</div>
                      <div>{t("倉庫")}</div>
                      <div>{t("類型")}</div>
                      <div style={{ textAlign: "right" }}>{t("變動")}</div>
                      <div>{t("原因")}</div>
                      <div>{t("關聯發票")}</div>
                    </div>
                    {movements.slice(0, movementsLimit).map(m => {
                      const wh = warehouses.find(w => w.id === m.warehouse_id);
                      const typeLabel = m.type === 'sale' ? t("銷售扣減") : m.type === 'adjust' ? t("手動調整") : (m.type || "—");
                      const typeColor = m.type === 'sale' ? { bg: "#fef3c7", fg: "#92400e" } : m.type === 'adjust' ? { bg: "#e0e7ff", fg: "#3b58d4" } : { bg: "#f5f5f5", fg: "#888" };
                      const inv = m.invoice_id ? invoices.find(iv => iv.id === m.invoice_id) : null;
                      const deltaColor = (m.delta || 0) > 0 ? "#22c55e" : (m.delta || 0) < 0 ? "#ef4444" : "#888";
                      const deltaPrefix = (m.delta || 0) > 0 ? "+" : "";
                      return (
                        <div key={m.id} style={{ display: "grid", gridTemplateColumns: "160px 90px 100px 80px 1fr 110px", gap: 12, padding: "10px 12px", borderBottom: "1px solid #f5f5f5", fontSize: 12, alignItems: "center" }}>
                          <div style={{ color: "#555" }}>{new Date(m.created_at).toLocaleString('zh-Hant', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</div>
                          <div style={{ color: "#666" }}>{wh ? t(wh.name.replace("分部", "")) : "—"}</div>
                          <div>
                            <span style={{ background: typeColor.bg, color: typeColor.fg, padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600 }}>{typeLabel}</span>
                          </div>
                          <div style={{ textAlign: "right", fontWeight: 700, color: deltaColor }}>{deltaPrefix}{m.delta}</div>
                          <div style={{ color: "#888", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={m.reason || ""}>{m.reason || "—"}</div>
                          <div style={{ color: inv ? "#6382ff" : "#aaa", fontSize: 11, fontFamily: "monospace" }}>{inv ? `#${inv.invoice_number || inv.id.slice(0, 8)}` : "—"}</div>
                        </div>
                      );
                    })}
                    {movements.length > movementsLimit && (
                      <div style={{ textAlign: "center", marginTop: 12 }}>
                        <button onClick={() => setMovementsLimit(l => l + 30)} style={{ background: "none", border: "1px solid #e0e0e0", borderRadius: 8, padding: "8px 16px", fontSize: 13, color: "#6382ff", cursor: "pointer", fontWeight: 600 }}>{t("載入更多")}</button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          );
}
