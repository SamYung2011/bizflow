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
  return "";
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
      /^\/internal\/admin\/feedback\/[1-9]\d*\/log-link$/.test(url.pathname)
    )
  );
}
