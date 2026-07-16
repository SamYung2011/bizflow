function abortError() {
  return new DOMException("SPA navigation aborted", "AbortError");
}

export function createRouteStyleManager(documentRef = document) {
  let activeLinks = new Set();

  function hrefOf(value) {
    return new URL(String(value || ""), documentRef.baseURI).href;
  }

  function stylesheetFor(href) {
    return [...documentRef.querySelectorAll('link[rel="stylesheet"][href]')]
      .find((link) => link.href === href) ?? null;
  }

  function adopt(styles = []) {
    activeLinks = new Set(styles.map(hrefOf).map((href) => {
      const link = stylesheetFor(href);
      if (link) link.dataset.spaRouteStyle = "active";
      return link;
    }).filter(Boolean));
  }

  async function prepare(styles = [], { signal } = {}) {
    if (signal?.aborted) throw abortError();
    const targetHrefs = [...new Set(styles.map(hrefOf))];
    const targetLinks = new Set();
    const createdLinks = [];

    try {
      await Promise.all(targetHrefs.map((href) => new Promise((resolve, reject) => {
        const existing = stylesheetFor(href);
        if (existing) {
          targetLinks.add(existing);
          resolve();
          return;
        }
        const link = documentRef.createElement("link");
        link.rel = "stylesheet";
        link.href = href;
        link.media = "not all";
        link.dataset.spaRouteStyle = "pending";
        let loaded = false;
        const finish = (error) => {
          if (loaded) return;
          loaded = true;
          link.onload = null;
          link.onerror = null;
          signal?.removeEventListener("abort", onAbort);
          if (error) reject(error);
          else resolve();
        };
        const onAbort = () => finish(abortError());
        link.onload = () => finish();
        link.onerror = () => finish(new Error(`Route stylesheet failed: ${href}`));
        signal?.addEventListener("abort", onAbort, { once: true });
        createdLinks.push(link);
        targetLinks.add(link);
        documentRef.head.append(link);
      })));
    } catch (error) {
      createdLinks.forEach((link) => link.remove());
      throw error;
    }

    let settled = false;
    return {
      commit() {
        if (settled) return;
        settled = true;
        targetLinks.forEach((link) => {
          link.media = "all";
          link.dataset.spaRouteStyle = "active";
        });
        activeLinks.forEach((link) => {
          if (!targetLinks.has(link)) link.remove();
        });
        activeLinks = targetLinks;
      },
      rollback() {
        if (settled) return;
        settled = true;
        createdLinks.forEach((link) => link.remove());
      }
    };
  }

  function dispose() {
    activeLinks.clear();
  }

  return Object.freeze({ adopt, prepare, dispose });
}
