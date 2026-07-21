type ShopifyStructureOption = {
  name: string;
  value: string;
};

type ShopifyStructureVariant = {
  id: string;
  sku: string;
  price: string;
  selectedOptions: ShopifyStructureOption[];
};

export type ShopifyStructureProduct = {
  title: string;
  status: string;
  productType: string;
  tags: string[];
  descriptionHtml: string;
  collectionIds: string[];
  variants: ShopifyStructureVariant[];
};

export const SHOPIFY_STRUCTURE_HASH_PREFIX = "shopify-structure-v1:";

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizedDecimal(value: unknown): string {
  const raw = text(value);
  if (!/^-?\d+(?:\.\d+)?$/.test(raw)) return raw;
  return raw.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, stable((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

export function shopifyStructureSnapshot(
  product: ShopifyStructureProduct,
  managedCollectionIds: Set<string>,
) {
  return {
    title: text(product.title),
    status: text(product.status).toUpperCase(),
    productType: text(product.productType),
    tags: [...new Set((product.tags || []).map(text).filter(Boolean))].sort(),
    descriptionHtml: text(product.descriptionHtml),
    managedCollectionIds: [
      ...new Set(
        (product.collectionIds || [])
          .map(text)
          .filter((id) => id && managedCollectionIds.has(id)),
      ),
    ].sort(),
    variants: (product.variants || []).map((variant) => ({
      id: text(variant.id),
      sku: text(variant.sku),
      price: normalizedDecimal(variant.price),
      selectedOptions: (variant.selectedOptions || []).map((option) => ({
        name: text(option.name),
        value: text(option.value),
      })).sort((left, right) =>
        `${left.name}\0${left.value}`.localeCompare(
          `${right.name}\0${right.value}`,
        )
      ),
    })).sort((left, right) =>
      `${left.id}\0${left.sku}`.localeCompare(`${right.id}\0${right.sku}`)
    ),
  };
}

export async function shopifyStructureHash(
  product: ShopifyStructureProduct,
  managedCollectionIds: Set<string>,
): Promise<string> {
  // updatedAt and inventory quantities are deliberately absent: Shopify itself
  // advances Product.updatedAt for tracked-inventory adjustments. Inventory has
  // its own changeFromQuantity CAS. Media stays outside v1 because productSet
  // attaches/processes files asynchronously; INV-img-1 compares the immutable
  // content-addressed BizFlow source URL instead of hashing transient CDN state.
  const encoded = new TextEncoder().encode(JSON.stringify(stable(
    shopifyStructureSnapshot(product, managedCollectionIds),
  )));
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `${SHOPIFY_STRUCTURE_HASH_PREFIX}${hex}`;
}

export function isShopifyStructureHash(value: unknown): boolean {
  return new RegExp(`^${SHOPIFY_STRUCTURE_HASH_PREFIX}[0-9a-f]{64}$`).test(
    text(value),
  );
}

export function shopifyCasDecision(
  baselineStructureHash: unknown,
  currentStructureHash: string,
): "refresh" | "conflict" {
  const baseline = text(baselineStructureHash);
  if (!isShopifyStructureHash(baseline)) return "refresh";
  return baseline === currentStructureHash ? "refresh" : "conflict";
}
