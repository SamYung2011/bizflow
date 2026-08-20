const RETRYABLE_PASSWORD_CODES = new Set([
  "hook_timeout",
  "hook_timeout_after_retry",
  "request_timeout",
  "unexpected_failure"
]);

function isProvableTransientAuthFailure(error) {
  const status = Number(error?.status);
  const code = String(error?.code || "").toLowerCase();
  return status >= 400 && RETRYABLE_PASSWORD_CODES.has(code);
}

// PostgREST errors do not expose the HTTP status used by the former retry
// predicate. Keep this read single-shot instead of retaining a dead branch.
export function readSignedInUser(readCurrentUser) {
  return readCurrentUser();
}

export async function completePasswordSignIn({ signIn, readCurrentUser, defer }) {
  // A password is resent only for explicit Auth server timeout/failure codes.
  // Missing/legacy codes and every credential/account verdict stay single-shot.
  try {
    await signIn();
  } catch (error) {
    if (!isProvableTransientAuthFailure(error)) throw error;
    await (defer?.() ?? new Promise((resolve) => setTimeout(resolve, 100)));
    await signIn();
  }
  return readSignedInUser(readCurrentUser);
}
