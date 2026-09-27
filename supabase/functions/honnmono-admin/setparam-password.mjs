// Recheck the current operator only for current changes. The temporary Auth
// session is logged out locally, and the password never reaches ota-admin.
export async function prepareSetparamBody(rawBody, {
  operatorEmail,
  supabaseUrl,
  anonKey,
  fetchImpl = fetch,
}) {
  const payload = JSON.parse(rawBody);
  const { password, ...forwarded } = payload;
  if (!Object.hasOwn(payload.params ?? {}, "rated_current")) {
    return { body: JSON.stringify(forwarded) };
  }
  if (typeof password !== "string" || !password) {
    return { error: "password_required", status: 403 };
  }

  let response;
  try {
    response = await fetchImpl(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: anonKey, "Content-Type": "application/json" },
      body: JSON.stringify({ email: operatorEmail, password }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    return { error: "password_check_failed", status: 503 };
  }
  if ([400, 401, 403, 422].includes(response.status)) {
    return { error: "password_incorrect", status: 403 };
  }
  if (response.status !== 200) {
    return { error: "password_check_failed", status: 503 };
  }

  let accessToken;
  try {
    accessToken = String((await response.json())?.access_token ?? "");
  } catch {
    return { error: "password_check_failed", status: 503 };
  }
  if (!accessToken) return { error: "password_check_failed", status: 503 };

  try {
    await fetchImpl(`${supabaseUrl}/auth/v1/logout?scope=local`, {
      method: "POST",
      headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // The password has already been verified; logout is best effort.
  }
  return { body: JSON.stringify(forwarded) };
}
