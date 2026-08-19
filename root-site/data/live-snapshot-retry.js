export const LIVE_SNAPSHOT_REFRESH_RETRY_DELAYS_MS = Object.freeze([250, 1000]);

function wait(delay) {
  return new Promise((resolve) => setTimeout(resolve, delay));
}

export async function retryLiveSnapshotRefresh(operation, {
  delays = LIVE_SNAPSHOT_REFRESH_RETRY_DELAYS_MS,
  sleep = wait,
  shouldRetry = () => true,
  onRetry = () => {}
} = {}) {
  let attempt = 0;
  while (true) {
    attempt += 1;
    try {
      return await operation({ attempt });
    } catch (error) {
      const delay = delays[attempt - 1];
      if (delay == null || !shouldRetry({ attempt, error })) throw error;
      onRetry({ attempt, nextAttempt: attempt + 1, delay, error });
      await sleep(delay);
    }
  }
}
