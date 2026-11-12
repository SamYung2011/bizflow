import { throwIfPageAborted } from "../spa/page-lifecycle.js";

// Keep existing task links and bookmarks, but open the standalone Team app.
export async function mountPage({ url, navigation, signal, scope } = {}) {
  throwIfPageAborted(signal, scope);
  const destination = new URL("/task-platform/team/", url);
  destination.search = url.search;
  destination.hash = url.hash;
  // The SPA has already pushed /team/index.html; replace it to avoid a back loop.
  navigation.hardNavigate(destination, { replace: true });
  throw new DOMException("Navigating to standalone task management", "AbortError");
}
