import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  type ShopifyCredentials,
  sanitizeError,
  shopifyGraphQL,
} from "../_shared/shopify-admin.ts";
import {
  isShopifyStructureHash,
  shopifyCasDecision,
  shopifyStructureHash,
} from "./structure.ts";
import { catalogMediaChanged } from "./image.ts";

type JsonRecord = Record<string, unknown>;

interface NormalizedStock {
  warehouseId: string;
  quantity: number;
}

interface NormalizedVariant {
  id: string;
  name: string;
  internalCode: string;
  price: number;
  warrantyMonths: number;
  status: string;
  imageUrl: string;
  specs: string;
  stocks: NormalizedStock[];
}

interface NormalizedProduct extends NormalizedVariant {
  category: string;
  productType: string;
  tags: string[];
  collections: string[];
  variants: NormalizedVariant[];
}

interface ShopifyInventoryLevel {
  locationId: string;
  quantity: number;
}

interface ShopifyVariantNode {
  id: string;
  title: string;
  sku: string;
  price: string;
  selectedOptions: Array<{ name: string; value: string }>;
  inventoryItemId: string;
  inventoryLevels: ShopifyInventoryLevel[];
}

interface ShopifyProductNode {
  id: string;
  title: string;
  handle: string;
  status: string;
  updatedAt: string;
  productType: string;
  tags: string[];
  descriptionHtml: string;
  featuredImageUrl: string;
  collectionIds: string[];
  variants: ShopifyVariantNode[];
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const PRODUCT_FIELDS = `
  id title handle status updatedAt productType tags descriptionHtml
  featuredImage { url }
  collections(first: 250) { nodes { id } }
  variants(first: 250) {
    nodes {
      id title sku price selectedOptions { name value }
      inventoryItem {
        id tracked
        inventoryLevels(first: 100) {
          nodes { location { id } quantities(names: ["available"]) { name quantity } }
        }
      }
    }
  }
`;

const PRODUCTS_QUERY = `
  query BizFlowProducts($cursor: String) {
    products(first: 100, after: $cursor, sortKey: TITLE) {
      pageInfo { hasNextPage endCursor }
      nodes { ${PRODUCT_FIELDS} }
    }
  }
`;

const PRODUCT_QUERY = `
  query BizFlowProduct($id: ID!) { product(id: $id) { ${PRODUCT_FIELDS} } }
`;

const LOCATIONS_QUERY = `
  query BizFlowLocations { locations(first: 100) { nodes { id name isActive } } }
`;

const COLLECTIONS_QUERY = `
  query BizFlowCollections { collections(first: 250, sortKey: TITLE) { nodes { id title } } }
`;

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function finiteNumber(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function sameTimestamp(left: unknown, right: unknown): boolean {
  const leftTime = Date.parse(text(left));
  const rightTime = Date.parse(text(right));
  return Number.isFinite(leftTime) && Number.isFinite(rightTime)
    ? leftTime === rightTime
    : text(left) === text(right);
}

function stringList(value: unknown): string[] {
  return [...new Set((Array.isArray(value) ? value : []).map(text).filter(Boolean))];
}

function normalizeStock(value: unknown): NormalizedStock {
  const row = value && typeof value === "object" ? value as JsonRecord : {};
  const warehouseId = text(row.warehouseId);
  const quantity = Math.trunc(finiteNumber(row.quantity));
  if (!UUID_PATTERN.test(warehouseId) || quantity < 0) throw new Error("Invalid warehouse stock payload");
  return { warehouseId, quantity };
}

function normalizeVariant(value: unknown): NormalizedVariant {
  const row = value && typeof value === "object" ? value as JsonRecord : {};
  const id = text(row.id);
  const name = text(row.name);
  const internalCode = text(row.internalCode);
  const price = finiteNumber(row.price, Number.NaN);
  const warrantyMonths = Math.trunc(finiteNumber(row.warrantyMonths));
  if (!UUID_PATTERN.test(id) || !name || !internalCode || !Number.isFinite(price) || price < 0 || warrantyMonths < 0) {
    throw new Error("Invalid Shopify variant payload");
  }
  const stocks = (Array.isArray(row.stocks) ? row.stocks : []).map(normalizeStock);
  if (new Set(stocks.map((stock) => stock.warehouseId)).size !== stocks.length) {
    throw new Error("Duplicate warehouse stock payload");
  }
  return {
    id,
    name,
    internalCode,
    price,
    warrantyMonths,
    status: text(row.status) || "active",
    imageUrl: text(row.imageUrl),
    specs: text(row.specs),
    stocks,
  };
}

export function normalizeCatalogProduct(value: unknown): NormalizedProduct {
  const row = value && typeof value === "object" ? value as JsonRecord : {};
  const base = normalizeVariant(row);
  const variants = (Array.isArray(row.variants) ? row.variants : []).map(normalizeVariant);
  const ids = new Set<string>([base.id]);
  const codes = new Set<string>([base.internalCode.toLowerCase()]);
  const names = new Set<string>();
  for (const variant of variants) {
    const normalizedName = variant.name.toLowerCase();
    if (ids.has(variant.id) || codes.has(variant.internalCode.toLowerCase()) || names.has(normalizedName)) {
      throw new Error("Duplicate variant ID, SKU, or option name");
    }
    ids.add(variant.id);
    codes.add(variant.internalCode.toLowerCase());
    names.add(normalizedName);
  }
  return {
    ...base,
    category: text(row.category),
    productType: text(row.productType),
    tags: stringList(row.tags),
    collections: stringList(row.collections),
    variants,
  };
}

function mapShopifyProduct(node: JsonRecord): ShopifyProductNode {
  const variants = ((node.variants as JsonRecord | undefined)?.nodes as JsonRecord[] | undefined || []).map((variant) => {
    const inventoryItem = variant.inventoryItem as JsonRecord | undefined;
    const inventoryLevels = ((inventoryItem?.inventoryLevels as JsonRecord | undefined)?.nodes as JsonRecord[] | undefined || []).map((level) => {
      const quantities = Array.isArray(level.quantities) ? level.quantities as JsonRecord[] : [];
      return {
        locationId: text((level.location as JsonRecord | undefined)?.id),
        quantity: finiteNumber(quantities.find((quantity) => quantity.name === "available")?.quantity),
      };
    });
    return {
      id: text(variant.id),
      title: text(variant.title),
      sku: text(variant.sku),
      price: text(variant.price),
      selectedOptions: Array.isArray(variant.selectedOptions)
        ? (variant.selectedOptions as JsonRecord[]).map((option) => ({ name: text(option.name), value: text(option.value) }))
        : [],
      inventoryItemId: text(inventoryItem?.id),
      inventoryLevels,
    };
  });
  return {
    id: text(node.id),
    title: text(node.title),
    handle: text(node.handle),
    status: text(node.status),
    updatedAt: text(node.updatedAt),
    productType: text(node.productType),
    tags: stringList(node.tags),
    descriptionHtml: text(node.descriptionHtml),
    featuredImageUrl: text((node.featuredImage as JsonRecord | undefined)?.url),
    collectionIds: (((node.collections as JsonRecord | undefined)?.nodes as JsonRecord[] | undefined) || []).map((item) => text(item.id)).filter(Boolean),
    variants,
  };
}

export async function fetchAllShopifyProducts(credentials: ShopifyCredentials): Promise<ShopifyProductNode[]> {
  const products: ShopifyProductNode[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 100; page += 1) {
    const data: { products?: { pageInfo?: { hasNextPage?: boolean; endCursor?: string }; nodes?: JsonRecord[] } } = await shopifyGraphQL(
      credentials,
      PRODUCTS_QUERY,
      { cursor },
    );
    products.push(...(data.products?.nodes || []).map(mapShopifyProduct));
    if (!data.products?.pageInfo?.hasNextPage) break;
    cursor = data.products.pageInfo.endCursor || null;
    if (!cursor) break;
  }
  return products;
}

async function fetchShopifyProduct(credentials: ShopifyCredentials, id: string): Promise<ShopifyProductNode | null> {
  const data = await shopifyGraphQL<{ product?: JsonRecord | null }>(credentials, PRODUCT_QUERY, { id });
  return data.product ? mapShopifyProduct(data.product) : null;
}

export async function buildAlignmentPlan(admin: SupabaseClient, credentials: ShopifyCredentials) {
  const [shopifyProducts, productsResult, linksResult, bindingsResult, mappingsResult, warehousesResult, locationsData, collectionsData] = await Promise.all([
    fetchAllShopifyProducts(credentials),
    admin.from("products")
      .select("id,name,parent_product_id,internal_code,status,category,collections")
      .eq("is_virtual", false)
      .or("category.neq._archived,category.is.null"),
    admin.from("shopify_variant_links").select("id,shopify_variant_id,shopify_product_id,shopify_sku,bizflow_product_id,qty"),
    admin.from("shopify_catalog_bindings").select("*").order("created_at"),
    admin.from("shopify_resource_mappings").select("*").order("kind").order("bizflow_key"),
    admin.from("warehouses").select("id,name,code").order("sort_order"),
    shopifyGraphQL<{ locations?: { nodes?: JsonRecord[] } }>(credentials, LOCATIONS_QUERY),
    shopifyGraphQL<{ collections?: { nodes?: JsonRecord[] } }>(credentials, COLLECTIONS_QUERY),
  ]);
  for (const result of [productsResult, linksResult, bindingsResult, mappingsResult, warehousesResult]) {
    if (result.error) throw new Error(`Alignment data read failed: ${result.error.message}`);
  }

  const products = productsResult.data || [];
  const links = linksResult.data || [];
  const shopifyById = new Map(shopifyProducts.map((product) => [product.id, product]));
  const productById = new Map(products.map((product) => [product.id, product]));
  const rootId = (product: { id: string; parent_product_id?: string | null }) => product.parent_product_id || product.id;
  const groups = new Map<string, string[]>();
  for (const product of products) {
    const key = rootId(product);
    const rows = groups.get(key) || [];
    rows.push(product.id);
    groups.set(key, rows);
  }
  const bindingByParent = new Map((bindingsResult.data || []).map((binding) => [binding.bizflow_parent_product_id, binding]));

  const plan = [...groups.entries()].map(([parentId, groupProductIds]) => {
    const groupSet = new Set(groupProductIds);
    const parent = productById.get(parentId);
    const existingBinding = bindingByParent.get(parentId) || null;
    const candidateIds = [...new Set(links.filter((link) => groupSet.has(link.bizflow_product_id)).map((link) => text(link.shopify_product_id)).filter(Boolean))];
    const externalCandidateIds = candidateIds.filter((candidateId) =>
      links.some((link) => text(link.shopify_product_id) === candidateId && !groupSet.has(link.bizflow_product_id)));
    const hasComplexComponentMap = (candidateId: string) => {
      const targetLinks = links.filter((link) =>
        text(link.shopify_product_id) === candidateId && groupSet.has(link.bizflow_product_id));
      const variantCounts = new Map<string, number>();
      const productCounts = new Map<string, number>();
      for (const link of targetLinks) {
        const variantId = text(link.shopify_variant_id);
        variantCounts.set(variantId, (variantCounts.get(variantId) || 0) + 1);
        productCounts.set(link.bizflow_product_id, (productCounts.get(link.bizflow_product_id) || 0) + 1);
      }
      return targetLinks.some((link) => Number(link.qty || 1) !== 1) ||
        [...variantCounts.values()].some((count) => count > 1) ||
        [...productCounts.values()].some((count) => count > 1);
    };
    const complexCandidateIds = candidateIds.filter(hasComplexComponentMap);
    let state = "unbound";
    let candidateShopifyProductId = "";
    let reason = "No unique Shopify product can be inferred";
    if (existingBinding) {
      state = shopifyById.has(existingBinding.shopify_product_id) && !hasComplexComponentMap(existingBinding.shopify_product_id)
        ? existingBinding.status
        : "conflict";
      candidateShopifyProductId = existingBinding.shopify_product_id;
      reason = state === "conflict"
        ? (complexCandidateIds.includes(existingBinding.shopify_product_id)
          ? "Bound Shopify product has a complex M:N component map"
          : "Bound Shopify product no longer exists")
        : "Existing catalogue binding";
    } else if (candidateIds.length === 1 && externalCandidateIds.length === 0 && complexCandidateIds.length === 0 && shopifyById.has(candidateIds[0])) {
      state = "ready_to_bind";
      candidateShopifyProductId = candidateIds[0];
      reason = "One unambiguous product inferred from component links";
    } else if (candidateIds.length > 1 || externalCandidateIds.length > 0 || complexCandidateIds.length > 0) {
      state = "conflict";
      reason = externalCandidateIds.length
        ? "Candidate Shopify product also references products outside this group"
        : complexCandidateIds.length
          ? "Candidate Shopify product has a complex M:N component map"
          : "BizFlow group points to multiple Shopify products";
    }
    const candidate = shopifyById.get(candidateShopifyProductId);
    return {
      bizflowParentProductId: parentId,
      bizflowName: text(parent?.name),
      bizflowInternalCode: text(parent?.internal_code),
      groupProductIds,
      state,
      reason,
      candidateShopifyProductId,
      candidateShopifyTitle: candidate?.title || "",
      candidateShopifyUpdatedAt: candidate?.updatedAt || "",
      candidateVariantCount: candidate?.variants.length || 0,
    };
  }).sort((a, b) => a.bizflowName.localeCompare(b.bizflowName));

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      bizflowProducts: plan.length,
      shopifyProducts: shopifyProducts.length,
      activeBindings: plan.filter((item) => item.state === "active").length,
      readyToBind: plan.filter((item) => item.state === "ready_to_bind").length,
      conflicts: plan.filter((item) => item.state === "conflict").length,
      unbound: plan.filter((item) => item.state === "unbound").length,
    },
    plan,
    shopifyProducts: shopifyProducts.map((product) => ({
      id: product.id, title: product.title, status: product.status, updatedAt: product.updatedAt,
      variants: product.variants.map((variant) => ({ id: variant.id, title: variant.title, sku: variant.sku })),
    })),
    mappings: mappingsResult.data || [],
    warehouses: warehousesResult.data || [],
    locations: (locationsData.locations?.nodes || []).map((location) => ({
      id: text(location.id), name: text(location.name), active: location.isActive === true,
    })),
    collectionKeys: [...new Set(products.flatMap((product) => stringList(product.collections)))].sort(),
    collections: (collectionsData.collections?.nodes || []).map((collection) => ({
      id: text(collection.id), title: text(collection.title),
    })),
  };
}

async function sha256(value: unknown): Promise<string> {
  const stable = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(stable);
    if (item && typeof item === "object") {
      return Object.fromEntries(Object.keys(item as JsonRecord).sort().map((key) => [key, stable((item as JsonRecord)[key])]));
    }
    return item;
  };
  const bytes = new TextEncoder().encode(JSON.stringify(stable(value)));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;")
    .replaceAll("\n", "<br>");
}

function shopifyStatus(status: string): string {
  if (status === "active" || status === "enabled") return "ACTIVE";
  if (status === "discontinued") return "ARCHIVED";
  return "DRAFT";
}

function mutationErrors(value: unknown): Array<{ field?: unknown; message?: unknown; code?: unknown }> {
  if (!value || typeof value !== "object") return [];
  const errors = (value as JsonRecord).userErrors;
  return Array.isArray(errors) ? errors as Array<{ field?: unknown; message?: unknown; code?: unknown }> : [];
}

function assertNoMutationErrors(value: unknown, operation: string): void {
  const errors = mutationErrors(value);
  if (errors.length) throw new Error(`${operation}: ${errors.map((error) => text(error.message)).join("; ")}`);
}

async function catalogueMappings(admin: SupabaseClient, product: NormalizedProduct) {
  const result = await admin.from("shopify_resource_mappings").select("kind,bizflow_key,shopify_resource_id").eq("active", true);
  if (result.error) throw new Error(`Resource mapping read failed: ${result.error.message}`);
  const rows = result.data || [];
  const locations = new Map(rows.filter((row) => row.kind === "location").map((row) => [row.bizflow_key, row.shopify_resource_id]));
  const collections = new Map(rows.filter((row) => row.kind === "collection").map((row) => [row.bizflow_key, row.shopify_resource_id]));
  const missingCollections = product.collections.filter((name) => !collections.has(name));
  if (missingCollections.length) throw new Error(`Missing Shopify collection mappings: ${missingCollections.join(",")}`);
  return {
    locations,
    collectionIds: product.collections.map((name) => collections.get(name)!).filter(Boolean),
    managedCollectionIds: new Set([...collections.values()].map(text).filter(Boolean)),
  };
}

async function managedShopifyCollectionIds(admin: SupabaseClient): Promise<Set<string>> {
  const result = await admin.from("shopify_resource_mappings")
    .select("shopify_resource_id")
    .eq("kind", "collection")
    .eq("active", true);
  if (result.error) throw new Error(`Collection mapping read failed: ${result.error.message}`);
  return new Set((result.data || []).map((row) => text(row.shopify_resource_id)).filter(Boolean));
}

async function reconcileShopifyCas(
  admin: SupabaseClient,
  binding: JsonRecord,
  current: ShopifyProductNode,
  expectedUpdatedAt: string,
  expectedStructureHash: string,
) {
  const timestampMatches = !expectedUpdatedAt || sameTimestamp(current.updatedAt, expectedUpdatedAt);
  const hasEditorStructureBaseline = isShopifyStructureHash(expectedStructureHash);
  if (timestampMatches && !hasEditorStructureBaseline) {
    return { conflict: false };
  }

  const managedCollectionIds = await managedShopifyCollectionIds(admin);
  const currentStructureHash = await shopifyStructureHash(current, managedCollectionIds);
  const baselineStructureHash = text(binding.shopify_structure_hash);
  const comparisonStructureHash = isShopifyStructureHash(expectedStructureHash)
    ? expectedStructureHash
    : baselineStructureHash;
  if (shopifyCasDecision(comparisonStructureHash, currentStructureHash) === "conflict") {
    return { conflict: true, currentStructureHash, baselineStructureHash: comparisonStructureHash };
  }
  if (timestampMatches && baselineStructureHash === currentStructureHash) {
    return { conflict: false, currentStructureHash };
  }

  // Product.updatedAt also advances for Shopify-owned activity such as tracked
  // inventory adjustments. If the BizFlow-owned structure is unchanged, absorb
  // that timestamp churn into the durable baseline and continue this same job.
  // A null baseline is a pre-093/legacy binding: first sight establishes the
  // versioned structure hash without rejecting the user's write.
  const refreshed = await admin.from("shopify_catalog_bindings").update({
    shopify_updated_at: current.updatedAt,
    shopify_structure_hash: currentStructureHash,
    verified_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", binding.id);
  if (refreshed.error) throw new Error(`Refresh Shopify CAS baseline failed: ${refreshed.error.message}`);
  return { conflict: false, currentStructureHash, refreshed: true };
}

async function ensureCatalogOwnership(admin: SupabaseClient, parentId: string, shopifyProductId: string) {
  const [products, links] = await Promise.all([
    admin.from("products").select("id,parent_product_id").or(`id.eq.${parentId},parent_product_id.eq.${parentId}`),
    admin.from("shopify_variant_links").select("shopify_product_id,shopify_variant_id,bizflow_product_id,qty"),
  ]);
  if (products.error || links.error) throw new Error("Unable to validate Shopify catalogue ownership");
  const groupIds = new Set((products.data || []).map((row) => row.id));
  groupIds.add(parentId);
  const targetLinks = (links.data || []).filter((link) => text(link.shopify_product_id) === shopifyProductId);
  const external = targetLinks.filter((link) => !groupIds.has(link.bizflow_product_id));
  if (external.length) throw new Error("SHOPIFY_MN_EXTERNAL_COMPONENT_BLOCK");
  const variantCounts = new Map<string, number>();
  const productCounts = new Map<string, number>();
  for (const link of targetLinks) {
    const variantId = text(link.shopify_variant_id);
    variantCounts.set(variantId, (variantCounts.get(variantId) || 0) + 1);
    productCounts.set(link.bizflow_product_id, (productCounts.get(link.bizflow_product_id) || 0) + 1);
  }
  if (targetLinks.some((link) => Number(link.qty || 1) !== 1) ||
      [...variantCounts.values()].some((count) => count > 1) ||
      [...productCounts.values()].some((count) => count > 1)) {
    throw new Error("SHOPIFY_MN_COMPLEX_COMPONENT_BLOCK");
  }
  return groupIds;
}

async function ensureDeleteDoesNotBreakExternalComponents(
  admin: SupabaseClient,
  groupIds: Set<string>,
  shopifyProductId: string,
) {
  const links = await admin.from("shopify_variant_links")
    .select("shopify_product_id,bizflow_product_id")
    .in("bizflow_product_id", [...groupIds]);
  if (links.error) throw new Error(`Unable to validate component reuse: ${links.error.message}`);
  const externallyReused = (links.data || []).some((link) =>
    text(link.shopify_product_id) && text(link.shopify_product_id) !== shopifyProductId);
  if (externallyReused) throw new Error("SHOPIFY_MN_EXTERNAL_REUSE_DELETE_BLOCK");
}

async function ensureBizflowIdDefinition(credentials: ShopifyCredentials) {
  const query = `
    query BizFlowIdDefinition {
      metafieldDefinition(identifier: {
        ownerType: PRODUCT
        namespace: "bizflow"
        key: "parent_product_id"
      }) {
        id
        namespace
        key
        metafieldsCount
        type { name }
      }
    }
  `;
  const loadDefinition = async () => {
    const result = await shopifyGraphQL<{ metafieldDefinition?: JsonRecord | null }>(credentials, query);
    return result.metafieldDefinition || null;
  };
  const definition = await loadDefinition();
  const definitionType = text((definition?.type as JsonRecord | undefined)?.name).toLowerCase();
  if (definitionType === "id") return;

  if (definition?.id) {
    // Definition types are immutable. Preserve any existing values as
    // unstructured metafields while replacing the incompatible schema; a new
    // id definition will validate and adopt compatible values.
    const deleteMutation = `
      mutation DeleteWrongBizFlowIdDefinition($id: ID!) {
        metafieldDefinitionDelete(id: $id, deleteAllAssociatedMetafields: false) {
          deletedDefinitionId
          userErrors { field message code }
        }
      }
    `;
    try {
      const deleted = await shopifyGraphQL<{ metafieldDefinitionDelete?: JsonRecord }>(credentials, deleteMutation, {
        id: definition.id,
      });
      assertNoMutationErrors(deleted.metafieldDefinitionDelete, "Replace incompatible BizFlow product identifier");
    } catch (error) {
      const concurrent = await loadDefinition();
      const concurrentType = text((concurrent?.type as JsonRecord | undefined)?.name).toLowerCase();
      if (concurrentType === "id") return;
      // A concurrent request can have deleted the same incompatible definition
      // and not recreated it yet. Continue to the id create only in that case.
      if (concurrent) throw error;
    }
  }

  const createMutation = `
    mutation CreateBizFlowId($definition: MetafieldDefinitionInput!) {
      metafieldDefinitionCreate(definition: $definition) { createdDefinition { id } userErrors { field message code } }
    }
  `;
  const variables = {
    definition: {
      name: "BizFlow parent product ID", namespace: "bizflow", key: "parent_product_id",
      description: "Stable BizFlow catalogue identifier", type: "id", ownerType: "PRODUCT",
    },
  };
  try {
    const result = await shopifyGraphQL<{ metafieldDefinitionCreate?: JsonRecord }>(credentials, createMutation, variables);
    assertNoMutationErrors(result.metafieldDefinitionCreate, "Prepare BizFlow product identifier");
  } catch (error) {
    // A concurrent create can win after our read/delete. Treat it as success
    // only when the exact definition now exists with the required id type.
    const concurrent = await loadDefinition();
    const concurrentType = text((concurrent?.type as JsonRecord | undefined)?.name).toLowerCase();
    if (concurrentType !== "id") throw error;
  }
}

function variantSetInput(
  product: NormalizedProduct,
  existing: ShopifyProductNode | null,
  collectionIds: string[],
  includeFiles: boolean,
) {
  const input: JsonRecord = {
    title: product.name,
    descriptionHtml: escapeHtml(product.specs),
    productType: product.productType,
    status: shopifyStatus(product.status),
    tags: product.tags,
    collections: collectionIds,
  };
  if (includeFiles) {
    const filename = product.imageUrl ? decodeURIComponent(new URL(product.imageUrl).pathname.split("/").pop() || "") : "";
    input.files = product.imageUrl ? [{
      originalSource: product.imageUrl,
      alt: product.name,
      contentType: "IMAGE",
      filename,
      duplicateResolutionMode: "REPLACE",
    }] : [];
  }
  if (product.variants.length) {
    const existingBySku = new Map((existing?.variants || []).map((variant) => [variant.sku.toLowerCase(), variant]));
    input.productOptions = [{
      name: "型號", position: 1,
      values: product.variants.map((variant) => ({ name: variant.name })),
    }];
    input.variants = product.variants.map((variant) => ({
      ...(existingBySku.get(variant.internalCode.toLowerCase())?.id ? { id: existingBySku.get(variant.internalCode.toLowerCase())!.id } : {}),
      optionValues: [{ optionName: "型號", name: variant.name }],
      sku: variant.internalCode,
      inventoryItem: { sku: variant.internalCode, tracked: true },
      price: variant.price,
    }));
  } else {
    // ProductSet list semantics deliberately collapse a manually-bound legacy
    // option topology when BizFlow says this catalogue item has no child variants.
    input.productOptions = [];
    input.variants = [];
  }
  return input;
}

async function setWarrantyMetafields(credentials: ShopifyCredentials, product: NormalizedProduct, shopifyProduct: ShopifyProductNode) {
  const variantBySku = new Map(shopifyProduct.variants.map((variant) => [variant.sku.toLowerCase(), variant]));
  const metafields: JsonRecord[] = [
    { ownerId: shopifyProduct.id, namespace: "bizflow", key: "warranty_months", type: "number_integer", value: String(product.warrantyMonths) },
  ];
  product.variants.forEach((variant) => {
    const ownerId = variantBySku.get(variant.internalCode.toLowerCase())?.id;
    if (ownerId) metafields.push({ ownerId, namespace: "bizflow", key: "warranty_months", type: "number_integer", value: String(variant.warrantyMonths) });
  });
  const mutation = `
    mutation SetBizFlowMetafields($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) { metafields { id } userErrors { field message code } }
    }
  `;
  const data = await shopifyGraphQL<{ metafieldsSet?: JsonRecord }>(credentials, mutation, { metafields });
  assertNoMutationErrors(data.metafieldsSet, "Set BizFlow metafields");
}

async function updateDefaultVariant(credentials: ShopifyCredentials, product: NormalizedProduct, shopifyProduct: ShopifyProductNode) {
  if (product.variants.length) return;
  const variant = shopifyProduct.variants[0];
  if (!variant) throw new Error("Shopify default variant missing");
  const mutation = `
    mutation UpdateDefaultVariant($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        productVariants { id sku }
        userErrors { field message }
      }
    }
  `;
  const data = await shopifyGraphQL<{ productVariantsBulkUpdate?: JsonRecord }>(credentials, mutation, {
    productId: shopifyProduct.id,
    variants: [{ id: variant.id, price: product.price, inventoryItem: { sku: product.internalCode, tracked: true } }],
  });
  assertNoMutationErrors(data.productVariantsBulkUpdate, "Update default variant");
}

async function syncInventory(
  credentials: ShopifyCredentials,
  product: NormalizedProduct,
  shopifyProduct: ShopifyProductNode,
  locations: Map<string, string>,
  jobId: string,
) {
  const sourceItems = product.variants.length ? product.variants : [product];
  const variantBySku = new Map(shopifyProduct.variants.map((variant) => [variant.sku.toLowerCase(), variant]));
  const quantities: JsonRecord[] = [];
  let activationIndex = 0;
  for (const item of sourceItems) {
    const variant = variantBySku.get(item.internalCode.toLowerCase()) || (sourceItems.length === 1 ? shopifyProduct.variants[0] : null);
    if (!variant?.inventoryItemId) throw new Error(`Shopify inventory item missing for ${item.internalCode}`);
    for (const stock of item.stocks) {
      const locationId = locations.get(stock.warehouseId);
      // An unmapped warehouse remains authoritative in BizFlow but is outside
      // Shopify inventory ownership. Skip it without blocking catalogue saves.
      if (!locationId) continue;
      let current = variant.inventoryLevels.find((level) => level.locationId === locationId)?.quantity;
      if (current == null) {
        const mutation = `
          mutation ActivateInventory($inventoryItemId: ID!, $locationId: ID!, $key: String!) {
            inventoryActivate(inventoryItemId: $inventoryItemId, locationId: $locationId, available: 0) @idempotent(key: $key) {
              inventoryLevel { id }
              userErrors { field message }
            }
          }
        `;
        const data = await shopifyGraphQL<{ inventoryActivate?: JsonRecord }>(credentials, mutation, {
          inventoryItemId: variant.inventoryItemId,
          locationId,
          key: `${jobId}-activate-${activationIndex++}`,
        });
        assertNoMutationErrors(data.inventoryActivate, "Activate inventory");
        current = 0;
      }
      quantities.push({
        inventoryItemId: variant.inventoryItemId,
        locationId,
        quantity: stock.quantity,
        changeFromQuantity: current,
      });
    }
  }
  if (!quantities.length) return;
  const mutation = `
    mutation SetInventory($input: InventorySetQuantitiesInput!, $key: String!) {
      inventorySetQuantities(input: $input) @idempotent(key: $key) {
        inventoryAdjustmentGroup { changes { name delta quantityAfterChange } }
        userErrors { field message code }
      }
    }
  `;
  const data = await shopifyGraphQL<{ inventorySetQuantities?: JsonRecord }>(credentials, mutation, {
    key: `${jobId}-set-available`,
    input: {
      name: "available",
      reason: "correction",
      referenceDocumentUri: `bizflow://shopify-catalog-jobs/${jobId}`,
      quantities,
    },
  });
  assertNoMutationErrors(data.inventorySetQuantities, "Set inventory quantities");
}

async function createOrUpdateShopifyProduct(
  admin: SupabaseClient,
  credentials: ShopifyCredentials,
  product: NormalizedProduct,
  existing: ShopifyProductNode | null,
  jobId: string,
  includeFiles: boolean,
) {
  const mappings = await catalogueMappings(admin, product);
  if (!existing) await ensureBizflowIdDefinition(credentials);
  const mutation = `
    mutation SetBizFlowProduct($input: ProductSetInput!, $identifier: ProductSetIdentifiers) {
      productSet(synchronous: true, input: $input, identifier: $identifier) {
        product { id updatedAt }
        userErrors { field message code }
      }
    }
  `;
  // BizFlow owns only collections represented by an explicit mapping. Shopify-only
  // collections stay attached; removing a mapped BizFlow collection still removes it.
  const collectionIds = [
    ...(existing?.collectionIds || []).filter((id) => !mappings.managedCollectionIds.has(id)),
    ...mappings.collectionIds,
  ];
  const input = variantSetInput(product, existing, [...new Set(collectionIds)], includeFiles);
  const identifier = existing
    ? { id: existing.id }
    : { customId: { namespace: "bizflow", key: "parent_product_id", value: product.id } };
  const data = await shopifyGraphQL<{ productSet?: JsonRecord }>(credentials, mutation, { input, identifier });
  assertNoMutationErrors(data.productSet, "Write Shopify product");
  const productId = text((data.productSet?.product as JsonRecord | undefined)?.id || existing?.id);
  if (!productId) throw new Error("Shopify product write returned no ID");
  let updated = await fetchShopifyProduct(credentials, productId);
  if (!updated) throw new Error("Shopify product disappeared after write");
  await updateDefaultVariant(credentials, product, updated);
  updated = await fetchShopifyProduct(credentials, productId);
  if (!updated) throw new Error("Shopify product disappeared after variant update");
  await setWarrantyMetafields(credentials, product, updated);
  await syncInventory(credentials, product, updated, mappings.locations, jobId);
  const finalProduct = await fetchShopifyProduct(credentials, productId);
  if (!finalProduct) throw new Error("Shopify product disappeared after inventory write");
  const sourceItems = product.variants.length ? product.variants : [product];
  const bySku = new Map(finalProduct.variants.map((variant) => [variant.sku.toLowerCase(), variant]));
  return {
    shopifyProductId: finalProduct.id,
    shopifyUpdatedAt: finalProduct.updatedAt,
    shopifyStructureHash: await shopifyStructureHash(finalProduct, mappings.managedCollectionIds),
    variants: sourceItems.map((item) => {
      const variant = bySku.get(item.internalCode.toLowerCase()) || finalProduct.variants[0];
      if (!variant) throw new Error(`Unable to match Shopify variant ${item.internalCode}`);
      return {
        bizflowProductId: item.id,
        shopifyVariantId: variant.id,
        shopifySku: variant.sku || item.internalCode,
        inventoryItemId: variant.inventoryItemId,
      };
    }),
  };
}

async function existingJob(admin: SupabaseClient, requestId: string) {
  const result = await admin.from("shopify_catalog_jobs").select("*").eq("request_id", requestId).maybeSingle();
  if (result.error) throw new Error(`Job lookup failed: ${result.error.message}`);
  return result.data;
}

async function ensureBizflowPayloadIdentity(
  admin: SupabaseClient,
  product: NormalizedProduct,
  action: "create" | "update",
) {
  const items = [product, ...product.variants];
  const ids = items.map((item) => item.id);
  const codes = items.map((item) => item.internalCode);
  const [idRows, codeRows] = await Promise.all([
    admin.from("products").select("id,parent_product_id,internal_code").in("id", ids),
    admin.from("products").select("id,parent_product_id,internal_code").in("internal_code", codes),
  ]);
  if (idRows.error || codeRows.error) throw new Error("Unable to validate BizFlow product identity");
  if (action === "create" && (idRows.data || []).length) throw new Error("BIZFLOW_PRODUCT_ID_ALREADY_EXISTS");
  if (action === "update") {
    const parent = (idRows.data || []).find((row) => row.id === product.id);
    if (!parent || parent.parent_product_id) throw new Error("BIZFLOW_PARENT_PRODUCT_STALE");
    const escaped = (idRows.data || []).some((row) =>
      row.id !== product.id && row.parent_product_id !== product.id);
    if (escaped) throw new Error("BIZFLOW_VARIANT_GROUP_MISMATCH");
  }
  const payloadIds = new Set(ids);
  if ((codeRows.data || []).some((row) => !payloadIds.has(row.id))) {
    throw new Error("BIZFLOW_PRODUCT_SKU_ALREADY_EXISTS");
  }
}

export async function executeCatalogWrite(
  admin: SupabaseClient,
  credentials: ShopifyCredentials,
  actorUserId: string,
  action: "create" | "update" | "delete",
  body: JsonRecord,
) {
  const requestId = text(body.requestId);
  if (!UUID_PATTERN.test(requestId)) throw new Error("Valid requestId required");
  const previous = await existingJob(admin, requestId);
  const product = action === "delete" ? null : normalizeCatalogProduct(body.product);
  const parentId = product?.id || text(body.bizflowParentProductId);
  if (!UUID_PATTERN.test(parentId)) throw new Error("Valid BizFlow parent product ID required");
  const payloadHash = await sha256(product || { parentId });
  if (previous && (text(previous.action) !== action || text(previous.payload_hash) !== payloadHash)) {
    throw new Error("SHOPIFY_REQUEST_ID_REUSE_MISMATCH");
  }
  if (previous?.status === "succeeded") return { ok: true, replay: true, job: previous, result: previous.result_payload };
  if (previous?.status === "shopify_applied_pending_db") {
    const applied = await admin.rpc("shopify_apply_catalog_job", { p_job_id: previous.id, p_shopify_result: previous.result_payload });
    if (applied.error) throw new Error(`Resume DB apply failed: ${applied.error.message}`);
    return { ok: true, replay: true, jobId: previous.id, result: applied.data };
  }
  if (product) await ensureBizflowPayloadIdentity(admin, product, action === "create" ? "create" : "update");
  if (!previous) {
    const pending = await admin.from("shopify_catalog_jobs").select("id,result_payload")
      .eq("bizflow_parent_product_id", parentId)
      .eq("action", action)
      .eq("payload_hash", payloadHash)
      .eq("status", "shopify_applied_pending_db")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (pending.error) throw new Error(`Pending job recovery failed: ${pending.error.message}`);
    if (pending.data) {
      const applied = await admin.rpc("shopify_apply_catalog_job", {
        p_job_id: pending.data.id,
        p_shopify_result: pending.data.result_payload,
      });
      if (applied.error) throw new Error(`Resume DB apply failed: ${applied.error.message}`);
      return { ok: true, replay: true, jobId: pending.data.id, result: applied.data };
    }
  }
  let job = previous;
  if (!job) {
    const inserted = await admin.from("shopify_catalog_jobs").insert({
      request_id: requestId,
      action,
      status: "pending",
      bizflow_parent_product_id: parentId,
      expected_shopify_updated_at: text(body.expectedShopifyUpdatedAt) || null,
      expected_shopify_structure_hash: text(body.expectedShopifyStructureHash) || null,
      request_payload: product ? { product } : { bizflowParentProductId: parentId },
      payload_hash: payloadHash,
      actor_user_id: actorUserId,
    }).select("*").single();
    if (inserted.error) throw new Error(`Create Shopify job failed: ${inserted.error.message}`);
    job = inserted.data;
  }
  await admin.from("shopify_catalog_jobs").update({
    status: "running", attempts: Number(job.attempts || 0) + 1, started_at: new Date().toISOString(),
    sanitized_error: null, updated_at: new Date().toISOString(),
  }).eq("id", job.id);

  try {
    const bindingResult = await admin.from("shopify_catalog_bindings").select("*")
      .eq("bizflow_parent_product_id", parentId).maybeSingle();
    if (bindingResult.error) throw new Error(`Binding lookup failed: ${bindingResult.error.message}`);
    const binding = bindingResult.data;
    if (action !== "create" && (!binding || binding.status !== "active")) throw new Error("SHOPIFY_BINDING_REQUIRED");
    if (action === "create" && binding) throw new Error("SHOPIFY_BINDING_ALREADY_EXISTS");

    const current = binding ? await fetchShopifyProduct(credentials, binding.shopify_product_id) : null;
    if (binding && !current && action !== "delete") throw new Error("SHOPIFY_BOUND_PRODUCT_MISSING");
    const expected = text(body.expectedShopifyUpdatedAt) || text(binding?.shopify_updated_at);
    const expectedStructureHash = text(body.expectedShopifyStructureHash);
    // The approved two-step delete is an explicit destructive intent. A remote
    // catalogue edit may inform an update, but must never lock that product out
    // of deletion.
    const cas = action !== "delete" && current && (expected || expectedStructureHash)
      ? await reconcileShopifyCas(admin, binding as JsonRecord, current, expected, expectedStructureHash)
      : { conflict: false };
    if (action !== "delete" && current && cas.conflict) {
      await admin.from("shopify_catalog_jobs").update({
        status: "conflict", sanitized_error: "SHOPIFY_UPDATED_AT_CONFLICT", updated_at: new Date().toISOString(),
      }).eq("id", job.id);
      return {
        ok: false,
        code: "SHOPIFY_UPDATED_AT_CONFLICT",
        error: "Shopify product changed outside BizFlow",
        conflict: true,
        currentUpdatedAt: current.updatedAt,
        currentStructureHash: cas.currentStructureHash,
        jobId: job.id,
      };
    }
    const groupIds = binding
      ? await ensureCatalogOwnership(admin, parentId, binding.shopify_product_id)
      : new Set<string>([parentId]);
    if (action === "delete" && binding) {
      await ensureDeleteDoesNotBreakExternalComponents(admin, groupIds, binding.shopify_product_id);
    }

    let result: JsonRecord;
    if (action === "delete") {
      if (current) {
        const mutation = `
          mutation DeleteBizFlowProduct($input: ProductDeleteInput!) {
            productDelete(input: $input, synchronous: true) {
              deletedProductId
              userErrors { field message }
            }
          }
        `;
        const data = await shopifyGraphQL<{ productDelete?: JsonRecord }>(credentials, mutation, { input: { id: binding.shopify_product_id } });
        assertNoMutationErrors(data.productDelete, "Delete Shopify product");
      }
      // A missing bound product is the expected remote end state and makes a
      // timed-out/retried delete safely resumable without a second mutation.
      result = { shopifyProductId: binding.shopify_product_id, deleted: true, alreadyMissing: !current };
    } else {
      const includeFiles = await catalogMediaChanged(admin, action, product!.id, product!.imageUrl);
      result = await createOrUpdateShopifyProduct(admin, credentials, product!, current, job.id, includeFiles);
    }

    await admin.from("shopify_catalog_jobs").update({
      status: "shopify_applied_pending_db", shopify_product_id: result.shopifyProductId,
      result_payload: result, updated_at: new Date().toISOString(),
    }).eq("id", job.id);
    const applied = await admin.rpc("shopify_apply_catalog_job", { p_job_id: job.id, p_shopify_result: result });
    if (applied.error) throw new Error(`Shopify applied; DB finalization pending: ${applied.error.message}`);
    return { ok: true, replay: false, jobId: job.id, result: applied.data };
  } catch (error) {
    const message = sanitizeError(error);
    const currentJob = await admin.from("shopify_catalog_jobs").select("status").eq("id", job.id).maybeSingle();
    if (currentJob.data?.status !== "shopify_applied_pending_db") {
      await admin.from("shopify_catalog_jobs").update({
        status: message.includes("CONFLICT") ? "conflict" : "failed",
        sanitized_error: message,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", job.id);
    }
    throw error;
  }
}

export async function confirmCatalogBinding(
  admin: SupabaseClient,
  credentials: ShopifyCredentials,
  actorUserId: string,
  body: JsonRecord,
) {
  const parentId = text(body.bizflowParentProductId);
  const shopifyProductId = text(body.shopifyProductId);
  if (!UUID_PATTERN.test(parentId) || !shopifyProductId.startsWith("gid://shopify/Product/")) throw new Error("Invalid binding target");
  await ensureCatalogOwnership(admin, parentId, shopifyProductId);
  const product = await fetchShopifyProduct(credentials, shopifyProductId);
  if (!product) throw new Error("Shopify product not found");
  const structureHash = await shopifyStructureHash(product, await managedShopifyCollectionIds(admin));
  const collision = await admin.from("shopify_catalog_bindings").select("bizflow_parent_product_id")
    .eq("shopify_product_id", shopifyProductId).neq("bizflow_parent_product_id", parentId).maybeSingle();
  if (collision.error) throw new Error(`Binding collision check failed: ${collision.error.message}`);
  if (collision.data) throw new Error("SHOPIFY_PRODUCT_ALREADY_BOUND");
  const result = await admin.from("shopify_catalog_bindings").upsert({
    bizflow_parent_product_id: parentId,
    shopify_product_id: shopifyProductId,
    shopify_updated_at: product.updatedAt,
    shopify_structure_hash: structureHash,
    status: "active",
    verified_at: new Date().toISOString(),
    created_by: actorUserId,
    updated_at: new Date().toISOString(),
  }, { onConflict: "bizflow_parent_product_id" }).select("*").single();
  if (result.error) throw new Error(`Confirm binding failed: ${result.error.message}`);
  return { ok: true, binding: result.data };
}

export async function mutateComponentLink(admin: SupabaseClient, action: "link" | "unlink", body: JsonRecord) {
  const variantId = text(body.shopifyVariantId);
  const productId = text(body.bizflowProductId);
  if (!variantId.startsWith("gid://shopify/ProductVariant/") || !UUID_PATTERN.test(productId)) throw new Error("Invalid component link");
  if (action === "unlink") {
    const result = await admin.from("shopify_variant_links").delete()
      .eq("shopify_variant_id", variantId).eq("bizflow_product_id", productId).select("id");
    if (result.error) throw new Error(`Unlink failed: ${result.error.message}`);
    return { ok: true, deleted: result.data?.length || 0 };
  }
  const qty = Math.max(1, Math.trunc(finiteNumber(body.qty, 1)));
  const result = await admin.from("shopify_variant_links").upsert({
    shopify_variant_id: variantId,
    bizflow_product_id: productId,
    shopify_product_id: text(body.shopifyProductId) || null,
    shopify_sku: text(body.shopifySku) || null,
    qty,
    updated_at: new Date().toISOString(),
  }, { onConflict: "shopify_variant_id,bizflow_product_id" }).select("*").single();
  if (result.error) throw new Error(`Link failed: ${result.error.message}`);
  return { ok: true, link: result.data };
}

export async function saveResourceMapping(admin: SupabaseClient, actorUserId: string, body: JsonRecord) {
  const kind = text(body.kind);
  const bizflowKey = text(body.bizflowKey);
  const shopifyResourceId = text(body.shopifyResourceId);
  const shopifyName = text(body.shopifyName);
  if (!['location', 'collection'].includes(kind) || !bizflowKey) throw new Error("Invalid Shopify resource mapping");
  if (!shopifyResourceId) {
    const removed = await admin.from("shopify_resource_mappings").delete()
      .eq("kind", kind).eq("bizflow_key", bizflowKey).select("id");
    if (removed.error) throw new Error(`Remove resource mapping failed: ${removed.error.message}`);
    return { ok: true, removed: removed.data?.length || 0 };
  }
  const prefix = kind === "location" ? "gid://shopify/Location/" : "gid://shopify/Collection/";
  if (!shopifyResourceId.startsWith(prefix)) throw new Error("Invalid Shopify resource ID");
  const result = await admin.from("shopify_resource_mappings").upsert({
    kind,
    bizflow_key: bizflowKey,
    shopify_resource_id: shopifyResourceId,
    shopify_name: shopifyName || null,
    active: true,
    created_by: actorUserId,
    updated_at: new Date().toISOString(),
  }, { onConflict: "kind,bizflow_key" }).select("*").single();
  if (result.error) throw new Error(`Save resource mapping failed: ${result.error.message}`);
  return { ok: true, mapping: result.data };
}
