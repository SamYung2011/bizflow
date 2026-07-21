import { allRows, asArray, asNumber, asText, formatDate, formatDateTime, timestamp } from "./live-snapshot-utils.js";

const INVENTORY_BUCKETS = ["轉插", "便攜充電", "充電線", "充電樁", "其它"];

function inferredInventoryBucket(product, productById) {
  if (product.parent_product_id && productById.has(product.parent_product_id)) {
    return inferredInventoryBucket(productById.get(product.parent_product_id), productById);
  }
  const category = asText(product.category).trim() || "未分類";
  if (INVENTORY_BUCKETS.includes(category)) return category;
  if (category === "停售" || category === "其它") return "其它";
  const name = asText(product.name);
  if (/充電寶|充电宝|portable|power\s*bank/i.test(name)) return "便攜充電";
  if (/充電線|充电线|cable|延長線|延长线/i.test(name)) return "充電線";
  if (/充電樁|充电桩|wallbox|wall charger/i.test(name)) return "充電樁";
  if (/adaptor|adapter|轉插|转接|轉接|ccs|gbt|gb\/t|type\s*2/i.test(name)) return "轉插";
  return "其它";
}

export async function buildInventorySnapshot() {
  const [rawProducts, warehouses, stocks, bindings, shopifyLinks] = await Promise.all([
    allRows("products", "name"),
    allRows("warehouses", "sort_order"),
    allRows("inventory_stock", null),
    allRows("shopify_catalog_bindings", null),
    allRows("shopify_variant_links", null)
  ]);
  const products = rawProducts.filter((product) => product.is_virtual !== true && asText(product.category) !== "_archived");
  const productById = new Map(products.map((product) => [product.id, product]));
  const childrenByParent = new Map();
  for (const product of products) {
    if (!product.parent_product_id) continue;
    const children = childrenByParent.get(product.parent_product_id) ?? [];
    children.push(product);
    childrenByParent.set(product.parent_product_id, children);
  }
  const warehouseById = new Map(warehouses.map((warehouse) => [warehouse.id, warehouse]));
  const stocksByProduct = new Map();
  for (const stock of stocks) {
    const list = stocksByProduct.get(stock.product_id) ?? [];
    list.push(stock);
    stocksByProduct.set(stock.product_id, list);
  }
  const ownStock = (id) => (stocksByProduct.get(id) ?? []).reduce((sum, stock) => sum + asNumber(stock.qty), 0);
  const ownWarehouses = (id) => (stocksByProduct.get(id) ?? []).map((stock) => {
    const warehouse = warehouseById.get(stock.warehouse_id);
    return {
      id: asText(stock.warehouse_id),
      key: asText(warehouse?.code).toLowerCase(),
      name: asText(warehouse?.name),
      quantity: asNumber(stock.qty),
      updatedAt: formatDateTime(stock.updated_at)
    };
  }).filter((row) => row.id).sort((a, b) => a.key.localeCompare(b.key));
  const groupIds = (product) => [product.id, ...(childrenByParent.get(product.id) ?? []).map((child) => child.id)];
  const groupedWarehouses = (product) => {
    const quantities = new Map();
    for (const productId of groupIds(product)) {
      for (const stock of stocksByProduct.get(productId) ?? []) {
        const current = quantities.get(stock.warehouse_id) ?? { quantity: 0, updatedAt: "" };
        current.quantity += asNumber(stock.qty);
        if (timestamp(stock.updated_at) > timestamp(current.updatedAt)) current.updatedAt = stock.updated_at;
        quantities.set(stock.warehouse_id, current);
      }
    }
    return [...quantities].map(([warehouseId, value]) => ({
      id: asText(warehouseId),
      key: asText(warehouseById.get(warehouseId)?.code).toLowerCase(),
      name: asText(warehouseById.get(warehouseId)?.name),
      quantity: value.quantity,
      updatedAt: formatDateTime(value.updatedAt)
    })).filter((row) => row.key === "hk" || row.key === "zh").sort((a, b) => a.key.localeCompare(b.key));
  };
  const bindingByParent = new Map(bindings.map((binding) => [binding.bizflow_parent_product_id, binding]));
  const directLinkFor = (productId, shopifyProductId) => shopifyLinks.find((link) =>
    link.bizflow_product_id === productId && (!shopifyProductId || link.shopify_product_id === shopifyProductId));
  const rows = products.map((product) => {
    const variants = childrenByParent.get(product.id) ?? [];
    const binding = product.parent_product_id ? null : bindingByParent.get(product.id);
    const stock = variants.length > 0
      ? groupIds(product).reduce((sum, id) => sum + ownStock(id), 0)
      : ownStock(product.id);
    return {
      id: product.id,
      name: asText(product.name),
      category: asText(product.category).trim() || "未分類",
      bucket: inferredInventoryBucket(product, productById),
      price: asNumber(product.price),
      stock,
      status: asText(product.status, "active") || "active",
      code: asText(product.code),
      internalCode: asText(product.internal_code),
      shopifySku: asText(product.shopify_sku),
      imageUrl: asText(product.image_url),
      parentId: product.parent_product_id ?? null,
      createdAt: formatDate(product.created_at),
      detail: {
        productId: asText(product.internal_code || product.code || product.shopify_sku),
        warrantyMonths: product.warranty_months == null ? null : asNumber(product.warranty_months),
        specs: asText(product.specs),
        productType: asText(product.product_type),
        collections: asArray(product.collections).map(String),
        tags: asArray(product.tags).map(String),
        images: product.image_url ? [String(product.image_url)] : [],
        warehouses: ownWarehouses(product.id),
        groupedWarehouses: groupedWarehouses(product),
        shopifyBinding: binding ? {
          shopifyProductId: asText(binding.shopify_product_id),
          updatedAt: asText(binding.shopify_updated_at),
          structureHash: asText(binding.shopify_structure_hash),
          status: asText(binding.status)
        } : null,
        variants: variants.map((variant) => ({
          ...(directLinkFor(variant.id, binding?.shopify_product_id) ? {
            shopifyVariantId: asText(directLinkFor(variant.id, binding?.shopify_product_id).shopify_variant_id)
          } : {}),
          id: variant.id,
          name: asText(variant.name),
          internalCode: asText(variant.internal_code || variant.code || variant.shopify_sku),
          price: asNumber(variant.price),
          stock: ownStock(variant.id),
          status: asText(variant.status, "active") || "active",
          shopifySku: asText(variant.shopify_sku),
          imageUrl: asText(variant.image_url),
          warrantyMonths: variant.warranty_months == null ? 0 : asNumber(variant.warranty_months),
          specs: asText(variant.specs),
          warehouses: ownWarehouses(variant.id)
        })).sort((a, b) => a.name.localeCompare(b.name))
      }
    };
  }).sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  const categoryCounts = new Map();
  rows.forEach((product) => categoryCounts.set(product.category, (categoryCounts.get(product.category) ?? 0) + 1));
  const categoriesRaw = [...categoryCounts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => name);
  return {
    generated_at: new Date().toISOString(),
    scope: "RLS-visible production inventory",
    pageSize: 18,
    warehouses: warehouses.map((warehouse) => ({
      id: asText(warehouse.id), key: asText(warehouse.code).toLowerCase(), name: asText(warehouse.name)
    })),
    buckets: INVENTORY_BUCKETS.slice(),
    categoriesRaw,
    products: rows
  };
}
