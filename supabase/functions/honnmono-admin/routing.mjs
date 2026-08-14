export function stripFunctionPrefix(pathname) {
  return pathname.replace(/^\/honnmono-admin(?=\/|$)/, "") || "/";
}

export function mapHonnmonoAdminPath(pathname, method) {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (method === "GET" && normalized === "/feedback") {
    return "/internal/admin/feedback";
  }
  if (method === "GET" && /^\/feedback\/[1-9]\d*$/.test(normalized)) {
    return `/internal/admin${normalized}`;
  }
  if (method === "POST" && /^\/feedback\/[1-9]\d*\/log-link$/.test(normalized)) {
    return `/internal/admin${normalized}`;
  }
  if (method === "GET" && normalized === "/device/binding") {
    return "/internal/admin/device/binding";
  }
  if (method === "POST" && normalized === "/device/unbind") {
    return "/internal/admin/device/unbind";
  }
  return "";
}

export function mapOtaAdminPath(pathname, method) {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (["GET", "POST"].includes(method) && normalized === "/ota/package") {
    return "/package";
  }
  return "";
}

export function validateOtaAdminBody(rawBody) {
  const parsed = JSON.parse(rawBody);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError("Invalid OTA JSON body");
  }
  return rawBody;
}

export function isAllowedHonnmonoApiBase(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "app-api.honnmono.top" &&
      url.port === "" &&
      url.username === "" &&
      url.password === "" &&
      (url.pathname === "" || url.pathname === "/") &&
      url.search === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}

export function isAllowedHonnmonoUpstream(url) {
  return (
    url.protocol === "https:" &&
    url.hostname === "app-api.honnmono.top" &&
    url.port === "" &&
    url.username === "" &&
    url.password === "" &&
    (
      url.pathname === "/internal/admin/feedback" ||
      /^\/internal\/admin\/feedback\/[1-9]\d*$/.test(url.pathname) ||
      /^\/internal\/admin\/feedback\/[1-9]\d*\/log-link$/.test(url.pathname) ||
      url.pathname === "/internal/admin/device/binding" ||
      url.pathname === "/internal/admin/device/unbind"
    )
  );
}

export function isAllowedOtaAdminBase(value) {
  try {
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      Boolean(url.hostname) &&
      url.username === "" &&
      url.password === "" &&
      (url.pathname === "" || url.pathname === "/") &&
      url.search === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}
