function noop() {}

export function throwIfPageAborted(signal) {
  if (signal?.aborted) throw new DOMException("SPA page mount aborted", "AbortError");
}

export function createPageScope(parentSignal = null) {
  const abortController = new AbortController();
  const cleanups = [];
  let disposed = false;

  function onCleanup(cleanup) {
    if (typeof cleanup !== "function") return noop;
    if (disposed) {
      try {
        cleanup();
      } catch (error) {
        console.warn("[spa] late page cleanup failed", error);
      }
      return noop;
    }
    cleanups.push(cleanup);
    return cleanup;
  }

  function listen(target, type, handler, options) {
    if (!target?.addEventListener || !target?.removeEventListener) return noop;
    target.addEventListener(type, handler, options);
    return onCleanup(() => target.removeEventListener(type, handler, options));
  }

  function timeout(callback, delay = 0) {
    const id = setTimeout(callback, delay);
    onCleanup(() => clearTimeout(id));
    return id;
  }

  function animationFrame(callback) {
    if (typeof requestAnimationFrame !== "function") return timeout(callback, 0);
    const id = requestAnimationFrame(callback);
    onCleanup(() => cancelAnimationFrame(id));
    return id;
  }

  function track(resource, cleanup) {
    if (!resource) return resource;
    const release = typeof cleanup === "function"
      ? () => cleanup(resource)
      : typeof resource.unsubscribe === "function"
        ? () => resource.unsubscribe()
        : typeof resource.disconnect === "function"
          ? () => resource.disconnect()
          : typeof resource.dispose === "function"
            ? () => resource.dispose()
            : null;
    onCleanup(release);
    return resource;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    abortController.abort();
    for (const cleanup of cleanups.splice(0).reverse()) {
      try {
        cleanup();
      } catch (error) {
        console.warn("[spa] page cleanup failed", error);
      }
    }
  }

  if (parentSignal) {
    const onParentAbort = () => dispose();
    if (parentSignal.aborted) dispose();
    else {
      parentSignal.addEventListener("abort", onParentAbort, { once: true });
      onCleanup(() => parentSignal.removeEventListener("abort", onParentAbort));
    }
  }

  return Object.freeze({
    signal: abortController.signal,
    get disposed() {
      return disposed;
    },
    onCleanup,
    listen,
    timeout,
    animationFrame,
    track,
    dispose
  });
}

function pageDescriptor(value) {
  const page = value?.page ?? value;
  if (!page || typeof page.render !== "function") {
    throw new TypeError("mountPage() must return a page descriptor with render().");
  }
  return {
    menu: Array.isArray(page.menu) ? page.menu : null,
    data: page.data && typeof page.data === "object" ? page.data : {},
    render: page.render,
    title: typeof page.title === "string" ? page.title : ""
  };
}

export async function mountPageModule(module, context = {}) {
  if (typeof module?.mountPage !== "function") {
    throw new TypeError("SPA route module must export mountPage(context).");
  }
  const scope = createPageScope(context.signal);
  try {
    const mounted = await module.mountPage({ ...context, scope, signal: scope.signal });
    const page = pageDescriptor(mounted);
    let active = false;
    let disposed = false;
    return {
      page,
      async activate() {
        if (disposed || active) return;
        active = true;
        await mounted?.activate?.();
      },
      async canLeave(details) {
        if (typeof mounted?.canLeave !== "function") return true;
        return await mounted.canLeave(details) !== false;
      },
      hasUnsavedChanges() {
        return typeof mounted?.hasUnsavedChanges === "function" && mounted.hasUnsavedChanges() === true;
      },
      captureState() {
        return typeof mounted?.captureState === "function" ? mounted.captureState() : null;
      },
      async dispose() {
        if (disposed) return;
        disposed = true;
        try {
          await mounted?.dispose?.();
        } finally {
          scope.dispose();
        }
      }
    };
  } catch (error) {
    scope.dispose();
    throw error;
  }
}
