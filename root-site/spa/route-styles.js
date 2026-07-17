function abortError() {
  return new DOMException("SPA navigation aborted", "AbortError");
}

export function createRouteStyleManager(documentRef = document) {
  let activeLinks = new Set();

  function hrefOf(value) {
    return new URL(String(value || ""), documentRef.baseURI).href;
  }

  function stylesheetFor(href, { includePending = false } = {}) {
    return [...documentRef.querySelectorAll('link[rel="stylesheet"][href]')]
      .find((link) => link.href === href && (includePending || link.dataset.spaRouteStyle !== "pending")) ?? null;
  }

  function createStylesheet(href, { media = "not all", state = "pending" } = {}) {
    const link = documentRef.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.media = media;
    link.dataset.spaRouteStyle = state;
    return link;
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
        // Pending links are owned by this prepare call. Reusing one would let
        // a superseded navigation remove a stylesheet required by its successor.
        const link = createStylesheet(href);
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
      ensureActive() {
        const repaired = [];
        const attachedLinks = new Set();
        targetHrefs.forEach((href) => {
          let link = stylesheetFor(href);
          if (!link) {
            link = createStylesheet(href, { media: "all", state: "active" });
            documentRef.head.append(link);
            repaired.push(href);
          } else if (link.media !== "all") {
            link.media = "all";
            link.dataset.spaRouteStyle = "active";
            repaired.push(href);
          }
          attachedLinks.add(link);
        });
        activeLinks = attachedLinks;
        if (repaired.length) {
          console.warn(`[spa] repaired missing route styles: ${repaired.join(", ")}`);
        }
        return repaired.length === 0;
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
