export const LANGUAGE_STORAGE_KEY = "bizflow-lang";
export const LANGUAGE_CODES = Object.freeze(["zh", "en", "fr"]);

function isLanguageCode(value) {
  return LANGUAGE_CODES.includes(String(value || ""));
}

export function resolveLanguagePreference({ search = "", storage } = {}) {
  const queryLanguage = new URLSearchParams(search).get("lang");
  if (isLanguageCode(queryLanguage)) return queryLanguage;
  try {
    const preferenceStorage = storage === undefined ? globalThis.localStorage : storage;
    const storedLanguage = preferenceStorage?.getItem(LANGUAGE_STORAGE_KEY);
    if (isLanguageCode(storedLanguage)) return storedLanguage;
  } catch {
    // Storage can be unavailable in private or hardened browser contexts.
  }
  return "zh";
}

export function persistLanguagePreference(language, storage) {
  if (!isLanguageCode(language)) return false;
  try {
    const preferenceStorage = storage === undefined ? globalThis.localStorage : storage;
    if (!preferenceStorage) return false;
    preferenceStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    return true;
  } catch {
    return false;
  }
}
