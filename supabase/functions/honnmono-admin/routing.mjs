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
  if (method === "GET" && normalized === "/devices/dc-pro") {
    return "/internal/admin/adapter-devices/dc-pro";
  }
  if (
    method === "GET" &&
    /^\/devices\/dc-pro\/[A-Za-z0-9_-]{1,64}\/sessions$/.test(normalized)
  ) {
    return `/internal/admin/adapter-devices${normalized.slice("/devices".length)}`;
  }
  if (method === "GET" && normalized === "/ota/legacy-packages") {
    return "/internal/admin/ota/legacy-packages";
  }
  if (
    method === "POST" &&
    /^\/ota\/legacy-packages\/(150001|150002|150003|150004)$/.test(normalized)
  ) {
    return `/internal/admin${normalized}`;
  }
  return "";
}

export function mapOtaAdminPath(pathname, method) {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (["GET", "POST"].includes(method) && normalized === "/ota/package") {
    return "/package";
  }
  if (method === "GET" && normalized === "/devices/flash") {
    return "/devices/flash";
  }
  if (
    method === "GET" &&
    /^\/devices\/flash\/[A-Za-z0-9_-]{1,64}\/sessions$/.test(normalized)
  ) {
    return normalized;
  }
  if (
    method === "GET" &&
    /^\/devices\/flash\/[A-Za-z0-9_-]{1,64}\/uploads\/[1-9]\d*$/.test(normalized)
  ) {
    return normalized;
  }
  if (
    method === "POST" &&
    /^\/devices\/flash\/[A-Za-z0-9_-]{1,64}\/actions$/.test(normalized)
  ) {
    return normalized;
  }
  if (
    method === "POST" &&
    /^\/ota\/legacy-packages\/(150001|150002|150003|150004)$/.test(normalized)
  ) {
    return normalized.replace(/^\/ota/, "");
  }
  return "";
}

export function mapFlashAdminPath(pathname, method) {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (
    method === "POST" &&
    /^\/devices\/flash\/[A-Za-z0-9_-]{1,64}\/unbind$/.test(normalized)
  ) {
    return `/internal/admin${normalized}`;
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
      url.pathname === "/internal/admin/device/unbind" ||
      url.pathname === "/internal/admin/adapter-devices/dc-pro" ||
      /^\/internal\/admin\/adapter-devices\/dc-pro\/[A-Za-z0-9_-]{1,64}\/sessions$/.test(url.pathname) ||
      url.pathname === "/internal/admin/ota/legacy-packages" ||
      /^\/internal\/admin\/ota\/legacy-packages\/(150001|150002|150003|150004)$/.test(url.pathname)
    )
  );
}

export function isAllowedOtaAdminBase(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "http:" &&
      url.hostname === "172.18.0.1" &&
      url.port === "8086" &&
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

export function isAllowedFlashAdminBase(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "http:" &&
      url.hostname === "172.18.0.1" &&
      url.port === "8090" &&
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
