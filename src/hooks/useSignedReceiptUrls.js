import { useEffect, useMemo, useState } from "react";
import { EXPENSE_RECEIPT_BUCKET, receiptPathFromStored } from "../../root-site/bizflow/expense-receipt-path.js";
import { createReceiptUrlCache } from "../../root-site/bizflow/expense-receipt-cache.js";

export function useSignedReceiptUrls(values, supabase, identity) {
  const pathsKey = JSON.stringify([...new Set(values.map(receiptPathFromStored).filter(Boolean))]);
  const [, refreshView] = useState(0);
  const cache = useMemo(() => createReceiptUrlCache(async (paths, ttl) => {
    const { data, error } = await supabase.storage.from(EXPENSE_RECEIPT_BUCKET).createSignedUrls(paths, ttl);
    if (error) throw error;
    return new Map((data || []).filter((item) => !item.error && item.path && item.signedUrl)
      .map((item) => [item.path, item.signedUrl]));
  }), [supabase, identity]);

  useEffect(() => () => cache.clear(), [cache]);
  useEffect(() => {
    let active = true;
    let pending = false;
    async function refresh() {
      if (pending) return;
      pending = true;
      try {
        await cache.resolve(JSON.parse(pathsKey));
      } catch (error) {
        console.warn("Expense receipt signing failed", error);
      } finally {
        pending = false;
        if (active) refreshView((value) => value + 1);
      }
    }
    void refresh();
    const timer = setInterval(refresh, 60 * 1000);
    return () => { active = false; clearInterval(timer); };
  }, [cache, pathsKey]);

  return Object.fromEntries(JSON.parse(pathsKey).map((path) => [path, cache.read(path)]));
}
