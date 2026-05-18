import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabaseClient.js'
import { isNonWarrantyItem } from '../lib/warranty.js'
import { useAppContext } from '../context/AppContext.jsx'
import { useT } from '../i18n.jsx'
import { Icon } from '../components/Icon.jsx'

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
            <label style={{ fontSize: 13, fontWeight: 700, color: "#555", minWidth: 80 }}>{w.name}</label>
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
