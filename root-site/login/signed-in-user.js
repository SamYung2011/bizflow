function isTransientFirstRequest(error) {
  const status = Number(error?.status);
  const code = String(error?.code || "").toLowerCase();
  return status === 400 && !["invalid_credentials", "email_not_confirmed", "weak_password"].includes(code);
}

// Password authentication can finish while the first PostgREST profile read is
// still observing the pre-login browser session. Retry that read once inside
// the same submit; credential errors are never retried.
export async function readSignedInUser(readCurrentUser, defer = () => new Promise((resolve) => setTimeout(resolve, 0))) {
  try {
    return await readCurrentUser();
  } catch (error) {
    if (!isTransientFirstRequest(error)) throw error;
    await defer();
    return readCurrentUser();
  }
}

export async function completePasswordSignIn({ signIn, readCurrentUser, defer }) {
  // A first 400 that is not a credential verdict is the browser-session race
  // observed after bundling. Absorb it once inside this click; an explicit
  // invalid password/email verdict still returns immediately.
  try {
    await signIn();
  } catch (error) {
    if (!isTransientFirstRequest(error)) throw error;
    await (defer?.() ?? new Promise((resolve) => setTimeout(resolve, 0)));
    await signIn();
  }
  return readSignedInUser(readCurrentUser, defer);
}
