import {
  isShopifyStructureHash,
  shopifyCasDecision,
  shopifyStructureHash,
  type ShopifyStructureProduct,
  shopifyStructureSnapshot,
} from "./structure.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function sample(): ShopifyStructureProduct {
  return {
    title: "CLAUDE product",
    status: "ACTIVE",
    productType: "Adapter",
    tags: ["new", "featured"],
    descriptionHtml: "<p>Managed by BizFlow</p>",
    collectionIds: [
      "gid://shopify/Collection/managed",
      "gid://shopify/Collection/shopify-only",
    ],
    variants: [{
      id: "gid://shopify/ProductVariant/1",
      sku: "CLAUDE-001",
      price: "100.00",
      selectedOptions: [{ name: "Title", value: "Default Title" }],
    }],
  };
}

const managed = new Set(["gid://shopify/Collection/managed"]);

Deno.test("structure hash ignores Shopify timestamp/inventory noise and unordered sets", async () => {
  const left = sample();
  const right = {
    ...sample(),
    // These extra live-query fields intentionally are not part of the snapshot.
    updatedAt: "2026-07-21T11:00:00Z",
    variants: [{
      ...sample().variants[0],
      price: "100.0",
      inventoryLevels: [{
        locationId: "gid://shopify/Location/1",
        quantity: 8,
      }],
    }],
    tags: ["featured", "new"],
    collectionIds: [
      "gid://shopify/Collection/another-shopify-only",
      "gid://shopify/Collection/managed",
    ],
  } as unknown as ShopifyStructureProduct;
  assert(
    await shopifyStructureHash(left, managed) ===
      await shopifyStructureHash(right, managed),
    "non-structural Shopify churn must not produce a conflict",
  );
});

Deno.test("structure hash changes only for BizFlow-owned catalogue structure", async () => {
  const baseline = await shopifyStructureHash(sample(), managed);
  assert(
    isShopifyStructureHash(baseline),
    "hash must carry a versioned marker for legacy-row detection",
  );

  const changes: ShopifyStructureProduct[] = [
    { ...sample(), title: "Externally renamed" },
    { ...sample(), status: "DRAFT" },
    { ...sample(), descriptionHtml: "<p>Externally edited</p>" },
    { ...sample(), collectionIds: [] },
    {
      ...sample(),
      variants: [{ ...sample().variants[0], sku: "EXTERNAL-SKU" }],
    },
    { ...sample(), variants: [{ ...sample().variants[0], price: "101.00" }] },
    {
      ...sample(),
      variants: [{
        ...sample().variants[0],
        id: "gid://shopify/ProductVariant/2",
      }],
    },
  ];
  for (const changed of changes) {
    assert(
      await shopifyStructureHash(changed, managed) !== baseline,
      `structural change was not detected: ${
        JSON.stringify(shopifyStructureSnapshot(changed, managed))
      }`,
    );
  }
});

Deno.test("CAS refreshes noise and legacy rows but conflicts on a real structural delta", async () => {
  const baseline = await shopifyStructureHash(sample(), managed);
  assert(
    shopifyCasDecision(null, baseline) === "refresh",
    "legacy rows must establish a baseline without deadlocking",
  );
  assert(
    shopifyCasDecision(baseline, baseline) === "refresh",
    "timestamp-only churn must refresh and continue",
  );
  const changed = await shopifyStructureHash({
    ...sample(),
    title: "External edit",
  }, managed);
  assert(
    shopifyCasDecision(baseline, changed) === "conflict",
    "real external structure changes must return 409",
  );
});
