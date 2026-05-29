import React from "react";
import { useT } from "../../../i18n.jsx";

// OcppFinance 5 個 sub-tab 共用的小組件 / 工具
// chargecms 財務數據（list 唯讀）：零寫入 / 不發 OCPP 命令 / 不動 vendor 8081 / 不動 chargecms PHP
// 公司內部後台 admin only：金額 / 銀行賬號等業務字段全明文（煊煊拍板）；認證憑證後端不返

// chargecms 金額字段（DECIMAL，mysql2 返字符串）→ 2 位小數
export function fmtMoney(v) {
  if (v == null || v === "") return "0.00";
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : String(v);
}

// 金額方向染色：tone "in"=入賬綠 / "out"=出賬紅 / null=中性黑
// chargecms money 字段恒為正數，入賬/出賬方向靠 typeKey 區分（不是數值正負）→ 見 flowTone
export function MoneyText({ value, tone = null }) {
  const txt = `HK$ ${fmtMoney(value)}`;
  if (tone === "in") return <span style={{ color: "#059669", fontWeight: 600 }}>{txt}</span>;
  if (tone === "out") return <span style={{ color: "#dc2626", fontWeight: 600 }}>{txt}</span>;
  return <span>{txt}</span>;
}

const TONE_BY_TYPE = {
  recharge: "in", refund: "in", income: "in",
  consume: "out", withdrawal: "out",
};
// 充值/退款/收入=入賬綠，消費/提現=出賬紅（chargecms money 恒正，方向靠 type 定）
export function flowTone(typeKey) {
  return TONE_BY_TYPE[typeKey] || null;
}

export function DetailRow({ label, children }) {
  return (
    <div style={{ display: "flex", gap: 8, fontSize: 13, padding: "3px 0" }}>
      <span style={{ color: "#888", minWidth: 88 }}>{label}</span>
      <span style={{ color: "#333", wordBreak: "break-word" }}>{children}</span>
    </div>
  );
}

const TONES = {
  green: { bg: "#d1fae5", fg: "#065f46" },
  red: { bg: "#fee2e2", fg: "#991b1b" },
  orange: { bg: "#fed7aa", fg: "#9a3412" },
  blue: { bg: "#dbeafe", fg: "#1e40af" },
  gray: { bg: "#f3f4f6", fg: "#6b7280" },
};

export function Chip({ label, tone = "gray" }) {
  const { bg, fg } = TONES[tone] || TONES.gray;
  return (
    <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 10, background: bg, color: fg, fontSize: 11, fontWeight: 600 }}>
      {label}
    </span>
  );
}

// 列表頂部過濾條外殼：標題 + 自定義 filter slot + 刷新 + 計數
export function FilterBar({ title, children, onRefresh, loading, count }) {
  const { t } = useT();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
      <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{title}</h3>
      {children}
      <button onClick={() => onRefresh({ force: true })} disabled={loading} style={{ padding: "4px 12px", borderRadius: 6, border: "1px solid #ddd", background: loading ? "#f3f4f6" : "#fff", cursor: loading ? "default" : "pointer", fontSize: 13 }}>
        {loading ? t("載入中…") : t("刷新")}
      </button>
      <span style={{ marginLeft: "auto", fontSize: 12, color: "#888" }}>
        {t("本頁")} {count} {t("條")}
      </span>
    </div>
  );
}

export function SearchBox({ value, onChange, onSubmit, placeholder, width = 220 }) {
  const { t } = useT();
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(); }} style={{ display: "flex", gap: 6 }}>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid #ddd", fontSize: 13, width }}
      />
      <button type="submit" style={{ padding: "4px 14px", borderRadius: 6, border: "1px solid #1976d2", background: "#1976d2", color: "#fff", fontSize: 13, cursor: "pointer" }}>
        {t("搜尋")}
      </button>
    </form>
  );
}

export function Select({ value, onChange, options }) {
  const { t } = useT();
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid #ddd", fontSize: 13 }}>
      {options.map(([v, label]) => (
        <option key={v} value={v}>{t(label)}</option>
      ))}
    </select>
  );
}

export function ErrorBanner({ message }) {
  if (!message) return null;
  return (
    <div style={{ background: "#ffebee", border: "1px solid #ffcdd2", color: "#c62828", padding: "8px 12px", borderRadius: 6, fontSize: 13, marginBottom: 12 }}>
      {message}
    </div>
  );
}

export function EmptyState({ message }) {
  return (
    <div style={{ padding: 40, textAlign: "center", color: "#888", border: "1px dashed #ddd", borderRadius: 8 }}>
      {message}
    </div>
  );
}

export function Pager({ offset, pageLimit, count, hasMore, loading, onPrev, onNext }) {
  const { t } = useT();
  const rangeStart = count ? offset + 1 : 0;
  const rangeEnd = offset + count;
  const btn = (disabled) => ({
    padding: "4px 14px", borderRadius: 6, border: "1px solid #ddd",
    background: disabled ? "#f3f4f6" : "#fff", color: disabled ? "#aaa" : "#333",
    fontSize: 13, cursor: disabled ? "default" : "pointer",
  });
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 12, marginTop: 12 }}>
      <button onClick={onPrev} disabled={loading || offset === 0} style={btn(offset === 0)}>{t("上一頁")}</button>
      <span style={{ fontSize: 12, color: "#888" }}>{rangeStart}-{rangeEnd}</span>
      <button onClick={onNext} disabled={loading || !hasMore} style={btn(!hasMore)}>{t("下一頁")}</button>
    </div>
  );
}

const TH_STYLE = { padding: "8px 10px", borderBottom: "1px solid #eee", fontWeight: 600, color: "#555" };
export function TableHead({ columns }) {
  return (
    <thead>
      <tr style={{ background: "#fafafa" }}>
        {columns.map((col) => {
          const label = typeof col === "string" ? col : col.label;
          const align = typeof col === "string" ? "left" : (col.align || "left");
          return <th key={label} style={{ ...TH_STYLE, textAlign: align }}>{label}</th>;
        })}
      </tr>
    </thead>
  );
}

export const TABLE_WRAP_STYLE = { overflowX: "auto", border: "1px solid #eee", borderRadius: 8 };
export const TABLE_STYLE = { width: "100%", borderCollapse: "collapse", fontSize: 13 };
export const TD_STYLE = { padding: "8px 10px" };
export const MONO_TD_STYLE = { padding: "8px 10px", fontFamily: "monospace", fontSize: 12 };

export function DetailToggleButton({ open, onClick }) {
  const { t } = useT();
  return (
    <button onClick={onClick} style={{ padding: "4px 10px", borderRadius: 4, border: "1px solid #e5e7eb", background: "#fff", color: "#1976d2", fontSize: 12, cursor: "pointer" }}>
      {open ? t("收起") : t("查看詳情")}
    </button>
  );
}

export function DetailGrid({ children }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "2px 24px" }}>
      {children}
    </div>
  );
}
