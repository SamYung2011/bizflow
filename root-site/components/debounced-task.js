export function createDebouncedTask(callback, {
  delay = 200,
  scheduleTimeout = setTimeout,
  cancelTimeout = clearTimeout
} = {}) {
  if (typeof callback !== "function") throw new TypeError("createDebouncedTask() requires a callback.");
  let timer = null;

  function cancel() {
    if (timer === null) return;
    cancelTimeout(timer);
    timer = null;
  }

  function schedule() {
    cancel();
    timer = scheduleTimeout(() => {
      timer = null;
      callback();
    }, delay);
  }

  function flush() {
    if (timer === null) return false;
    cancel();
    callback();
    return true;
  }

  return Object.freeze({ cancel, flush, schedule });
}
