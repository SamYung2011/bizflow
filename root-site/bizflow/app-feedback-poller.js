export const FEEDBACK_POLL_INTERVAL_MS = 30_000;
export const FEEDBACK_POLL_MAX_INTERVAL_MS = 120_000;

export function feedbackPollDelay(consecutiveFailures = 0) {
  const failures = Math.max(0, Number(consecutiveFailures) || 0);
  return Math.min(
    FEEDBACK_POLL_INTERVAL_MS * (2 ** failures),
    FEEDBACK_POLL_MAX_INTERVAL_MS,
  );
}

function normalizedFacets(facets) {
  return {
    clientModels: Array.isArray(facets?.clientModels)
      ? facets.clientModels
      : [],
    appVersions: Array.isArray(facets?.appVersions)
      ? facets.appVersions
      : [],
    statuses: Array.isArray(facets?.statuses) ? facets.statuses : [],
  };
}

export function applyFeedbackListPayload(targetState, payload) {
  targetState.rows = Array.isArray(payload?.items) ? payload.items : [];
  targetState.total = Number(payload?.total) || 0;
  targetState.facets = normalizedFacets(payload?.facets);
}

export function feedbackListSignature(payload) {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const facets = normalizedFacets(payload?.facets);
  return JSON.stringify([
    Number(payload?.total) || 0,
    items.map((row) => [
      row?.id ?? null,
      row?.createTime ?? null,
      row?.status ?? null,
      row?.clientModel ?? null,
      row?.appVersion ?? null,
      row?.contact ?? null,
      row?.content ?? null,
      row?.logStatus ?? null,
      row?.logExternalUrl ?? null,
    ]),
    facets.clientModels,
    facets.appVersions,
    facets.statuses,
  ]);
}

export function feedbackStateSignature(targetState) {
  return feedbackListSignature({
    items: targetState?.rows,
    total: targetState?.total,
    facets: targetState?.facets,
  });
}

export function createFeedbackPoller({
  scope,
  documentRef,
  poll,
  clearTimeoutFn = globalThis.clearTimeout,
}) {
  if (
    !scope?.timeout ||
    !scope?.listen ||
    !scope?.onCleanup ||
    !scope?.isCurrent ||
    !scope?.signal?.addEventListener
  ) {
    throw new TypeError("Feedback polling requires a page scope");
  }
  if (!documentRef?.addEventListener || typeof poll !== "function") {
    throw new TypeError("Feedback polling requires a document and poll callback");
  }

  let timerId = null;
  let running = false;
  let rerunImmediately = false;
  let consecutiveFailures = 0;
  let disposed = false;
  let enabled = false;
  let runAbortController = null;

  function isVisibleAndActive() {
    return (
      !disposed &&
      enabled &&
      scope.isCurrent() === true &&
      documentRef.visibilityState === "visible"
    );
  }

  function cancelTimer() {
    if (timerId == null) return;
    clearTimeoutFn(timerId);
    timerId = null;
  }

  function abortRunningPoll() {
    runAbortController?.abort();
  }

  function schedule(delay = feedbackPollDelay(consecutiveFailures)) {
    cancelTimer();
    if (!isVisibleAndActive()) return;
    timerId = scope.timeout(() => {
      timerId = null;
      return runPoll();
    }, delay);
  }

  async function runPoll({ immediate = false } = {}) {
    if (!isVisibleAndActive()) return;
    if (running) {
      if (immediate) rerunImmediately = true;
      return;
    }

    running = true;
    const controller = new AbortController();
    runAbortController = controller;
    const abortFromScope = () => controller.abort();
    if (scope.signal.aborted) abortFromScope();
    else scope.signal.addEventListener("abort", abortFromScope, { once: true });
    let succeeded = false;
    try {
      succeeded = (await poll({ signal: controller.signal })) !== false;
    } catch {
      succeeded = false;
    } finally {
      scope.signal.removeEventListener("abort", abortFromScope);
      if (runAbortController === controller) runAbortController = null;
      running = false;
      if (!isVisibleAndActive()) return;
      if (rerunImmediately) {
        rerunImmediately = false;
        await runPoll();
        return;
      }
      consecutiveFailures = succeeded
        ? 0
        : Math.min(consecutiveFailures + 1, 2);
      schedule(feedbackPollDelay(consecutiveFailures));
    }
  }

  function handleVisibilityChange() {
    cancelTimer();
    if (documentRef.visibilityState !== "visible") {
      rerunImmediately = false;
      abortRunningPoll();
      return;
    }
    if (isVisibleAndActive()) return runPoll({ immediate: true });
  }

  scope.listen(documentRef, "visibilitychange", handleVisibilityChange);
  scope.onCleanup(() => {
    disposed = true;
    rerunImmediately = false;
    cancelTimer();
    abortRunningPoll();
  });

  return Object.freeze({
    start() {
      enabled = true;
      schedule(FEEDBACK_POLL_INTERVAL_MS);
    },
    pause() {
      enabled = false;
      rerunImmediately = false;
      cancelTimer();
      abortRunningPoll();
    },
    resume() {
      if (disposed) return;
      enabled = true;
      consecutiveFailures = 0;
      schedule(FEEDBACK_POLL_INTERVAL_MS);
    },
    restart() {
      consecutiveFailures = 0;
      schedule(FEEDBACK_POLL_INTERVAL_MS);
    },
    refreshNow() {
      enabled = true;
      cancelTimer();
      return runPoll({ immediate: true });
    },
    dispose() {
      disposed = true;
      enabled = false;
      rerunImmediately = false;
      cancelTimer();
      abortRunningPoll();
    },
  });
}
