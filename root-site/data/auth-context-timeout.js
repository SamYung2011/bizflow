export const AUTH_CONTEXT_TIMEOUT_MS = 15_000;

export class AuthContextTimeoutError extends Error {
  constructor(label, timeoutMs) {
    super(`Auth context ${label} timed out after ${timeoutMs}ms`);
    this.name = "AuthContextTimeoutError";
    this.code = "auth_context_timeout";
    this.label = label;
  }
}

export function withTimeout(promise, timeoutMs, label) {
  let timer = null;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new AuthContextTimeoutError(label, timeoutMs));
    }, timeoutMs);
  });
  return Promise.race([Promise.resolve(promise), timeout])
    .finally(() => clearTimeout(timer));
}
