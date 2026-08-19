export const LIVE_SNAPSHOT_REFRESH_RETRY_WINDOWS_MS = Object.freeze([
  Object.freeze([500, 1500]),
  Object.freeze([2000, 4000])
]);

function wait(delay) {
  return new Promise((resolve) => setTimeout(resolve, delay));
}

function retryDelay(value, random) {
  if (!Array.isArray(value)) return value;
  const [minimum = 0, maximum = minimum] = value;
  const sample = Math.min(1, Math.max(0, Number(random()) || 0));
  return Math.round(minimum + ((maximum - minimum) * sample));
}

export async function retryLiveSnapshotRefresh(operation, {
  delays = LIVE_SNAPSHOT_REFRESH_RETRY_WINDOWS_MS,
  sleep = wait,
  random = Math.random,
  shouldRetry = () => true,
  onRetry = () => {}
} = {}) {
  let attempt = 0;
  while (true) {
    attempt += 1;
    try {
      return await operation({ attempt });
    } catch (error) {
      const delayConfig = delays[attempt - 1];
      if (delayConfig == null || !shouldRetry({ attempt, error })) throw error;
      const delay = retryDelay(delayConfig, random);
      onRetry({ attempt, nextAttempt: attempt + 1, delay, error });
      await sleep(delay);
      if (!shouldRetry({ attempt, error })) throw error;
    }
  }
}
