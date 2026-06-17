// 轻量事件桥：业务代码 emit toast 不需要 hook、不进 AppContext。
// <ToastHost /> 订阅事件桥渲染 UI。
//
// 用法：
//   import { toastError, toastSuccess, toastInfo } from "../lib/toast.js";
//   toastError(t("保存失敗"), { detail: err });    // 内部 console.error(err) 留日志
//   toastSuccess(t("已儲存"));
//   toastInfo(t("提示"), { sub: t("有 3 個 SKU 庫存低") });
//
// 设计原则：
//   - error.message 不进 UI（防 Supabase 内部错 / RLS / JWT 等泄露）
//   - title 必须走 t() — 业务代码自己包好再传
//   - detail 走 console.error，开发者 devtools 可查
//   - 队列上限 5，防业务死循环刷屏

const listeners = new Set();
let seq = 1;

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(payload) {
  for (const fn of listeners) fn(payload);
}

function buildToast(kind, title, opts = {}) {
  const id = seq++;
  return {
    id,
    kind,
    title: String(title ?? ""),
    sub: opts.sub ? String(opts.sub) : null,
    durationMs: opts.durationMs ?? (kind === "error" ? 5000 : 3000),
  };
}

export function toastError(title, opts = {}) {
  if (opts.detail !== undefined) console.error("[toastError]", title, opts.detail);
  emit(buildToast("error", title, opts));
}

export function toastWarn(title, opts = {}) {
  if (opts.detail !== undefined) console.warn("[toastWarn]", title, opts.detail);
  emit(buildToast("warn", title, opts));
}

export function toastSuccess(title, opts = {}) {
  emit(buildToast("success", title, opts));
}

export function toastInfo(title, opts = {}) {
  emit(buildToast("info", title, opts));
}
