import { getInventoryPageData } from "./provider.js";

// Shared by create and edit; the existing six-table inventory loader is unchanged.
export async function getOrderProductPickerData() {
  const inventory = await getInventoryPageData();
  return {
    productGroups: inventory.products.map((product) => ({
      id: product.id,
      name: product.name,
      options: (product.detail?.variants.length ? product.detail.variants : [product]).map((option) => ({
        id: option.id, label: option.name, price: option.price
      }))
    }))
  };
}
