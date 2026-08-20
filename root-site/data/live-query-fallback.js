export async function resolveLiveQueryOrLegacy({ readLive, miss, readLegacy, onError = () => {} }) {
  try {
    const value = await readLive();
    if (value !== miss) return value;
  } catch (error) {
    onError(error);
  }
  return readLegacy();
}

export async function resolveOrderPageRead({ query, readLegacy, readPage }) {
  if (query === undefined) return readLegacy();
  return readPage(query);
}
