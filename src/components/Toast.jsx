import React, { useEffect, useState, useCallback } from "react";
import { subscribe } from "../lib/toast.js";

const MAX_QUEUE = 5;

const KIND_STYLE = {
  error:   { border: "#f4c4c4", icon: "⚠", iconColor: "#ef4444" },
  warn:    { border: "#fde68a", icon: "⚠", iconColor: "#f59e0b" },
  success: { border: "#bbf7d0", icon: "✓", iconColor: "#16a34a" },
  info:    { border: "#bfdbfe", icon: "ℹ", iconColor: "#2563eb" },
};

export function ToastHost() {
  const [queue, setQueue] = useState([]);

  useEffect(() => subscribe(t => {
    setQueue(q => {
      const next = [...q, t];
      return next.length > MAX_QUEUE ? next.slice(-MAX_QUEUE) : next;
    });
  }), []);

  const dismiss = useCallback(id => {
    setQueue(q => q.filter(t => t.id !== id));
  }, []);

  useEffect(() => {
    if (queue.length === 0) return;
    const timers = queue.map(t => setTimeout(() => dismiss(t.id), t.durationMs));
    return () => timers.forEach(clearTimeout);
  }, [queue, dismiss]);

  if (queue.length === 0) return null;

  return (
    <div style={{ position: "fixed", right: 28, bottom: 28, display: "flex", flexDirection: "column", gap: 10, zIndex: 350, alignItems: "flex-end" }}>
      {queue.map(t => {
        const s = KIND_STYLE[t.kind] || KIND_STYLE.info;
        return (
          <div key={t.id} style={{ width: 440, background: "#fff", borderRadius: 14, boxShadow: "0 10px 32px rgba(0,0,0,0.18)", border: `1px solid ${s.border}`, padding: "16px 18px 16px 20px", display: "flex", gap: 14, alignItems: "flex-start" }}>
            <div style={{ fontSize: 22, color: s.iconColor, lineHeight: 1, marginTop: 2 }}>{s.icon}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: t.sub ? 4 : 0, color: "#1f2937", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{t.title}</div>
              {t.sub && <div style={{ fontSize: 13, color: "#6b7280", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{t.sub}</div>}
            </div>
            <button onClick={() => dismiss(t.id)} style={{ background: "none", border: "none", color: "#aaa", cursor: "pointer", fontSize: 20, padding: 0, lineHeight: 1, marginTop: -2 }}>×</button>
          </div>
        );
      })}
    </div>
  );
}
