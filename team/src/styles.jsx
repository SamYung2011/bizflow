// 共享設計 tokens + 工具
export const c = {
  bg: '#fafaf9',
  card: '#ffffff',
  border: '#e7e5e4',
  borderHover: '#d6d3d1',
  text: '#1c1917',
  textMuted: '#78716c',
  textFaint: '#a8a29e',
  accent: '#2563eb',
  accentBg: '#eff6ff',
  green: '#16a34a',
  greenBg: '#f0fdf4',
  red: '#dc2626',
  redBg: '#fef2f2',
  amber: '#d97706',
  amberBg: '#fffbeb',
}
export const radius = { sm: 6, md: 8, lg: 12 }
export const font = { ui: "-apple-system, BlinkMacSystemFont, 'Inter', 'SF Pro Text', 'Segoe UI', sans-serif" }
export const BREAKPOINT = 768

export const S = {
  input: { width: '100%', padding: '8px 10px', borderRadius: radius.sm, border: `1px solid ${c.border}`, fontSize: 13, outline: 'none', marginBottom: 8, boxSizing: 'border-box', fontFamily: font.ui, color: c.text, background: c.card },
  btnPrimary: { background: c.accent, color: '#fff', border: 'none', padding: '7px 14px', borderRadius: radius.sm, fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: font.ui },
  btnSuccess: { background: c.green, color: '#fff', border: 'none', padding: '7px 14px', borderRadius: radius.sm, fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: font.ui },
  btnDanger: { background: c.card, color: c.red, border: `1px solid ${c.border}`, padding: '7px 14px', borderRadius: radius.sm, fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: font.ui },
  btnGhost: { background: c.card, color: c.text, border: `1px solid ${c.border}`, padding: '7px 14px', borderRadius: radius.sm, fontWeight: 500, fontSize: 13, cursor: 'pointer', fontFamily: font.ui },
  btnGhostSm: { background: 'transparent', color: c.textMuted, border: `1px solid ${c.border}`, padding: '5px 10px', borderRadius: radius.sm, fontSize: 12, cursor: 'pointer', fontFamily: font.ui },
  iconBtn: { background: 'transparent', border: 'none', color: c.textMuted, cursor: 'pointer', fontSize: 13, padding: 2, lineHeight: 1, fontFamily: font.ui },
  segmentBtn: (active) => ({ flex: 1, background: active ? c.card : 'transparent', color: active ? c.text : c.textMuted, border: 'none', boxShadow: active ? '0 1px 2px rgba(0,0,0,0.05)' : 'none', padding: '7px 12px', borderRadius: radius.sm, fontSize: 13, fontWeight: active ? 600 : 500, cursor: 'pointer', fontFamily: font.ui }),
  navBtn: (active) => ({ background: active ? c.bg : 'transparent', color: active ? c.text : c.textMuted, border: 'none', padding: '6px 12px', borderRadius: radius.sm, fontSize: 13, fontWeight: active ? 600 : 500, cursor: 'pointer', fontFamily: font.ui }),
  sectionHeader: { background: 'transparent', border: 'none', color: c.textMuted, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4, cursor: 'pointer', padding: '6px 0 8px', display: 'flex', alignItems: 'center', fontFamily: font.ui },
  modal: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, fontFamily: font.ui },
  modalCard: (w = 540) => ({ background: c.card, borderRadius: radius.lg, padding: 24, width: w, maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }),
}

import { supabase } from './supabaseClient.js'
export async function fetchAllTable(table, orderCol, ascending = true, filters = {}) {
  let q = supabase.from(table).select('*')
  for (const [col, val] of Object.entries(filters)) {
    if (val === null) q = q.is(col, null); else q = q.eq(col, val)
  }
  if (orderCol) q = q.order(orderCol, { ascending })
  const { data, error } = await q
  if (error) throw error
  return data || []
}

import React, { useState, useEffect } from 'react'
export function useIsMobile() {
  const [is, setIs] = useState(() => typeof window !== 'undefined' && window.innerWidth < BREAKPOINT)
  useEffect(() => {
    const handler = () => setIs(window.innerWidth < BREAKPOINT)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])
  return is
}

export const Center = ({ children }) => <div style={{ minHeight: '100vh', background: c.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 14, padding: 20, fontFamily: font.ui, color: c.text }}>{children}</div>
export const Empty = ({ children }) => <div style={{ background: c.card, border: `1px dashed ${c.border}`, borderRadius: radius.lg, padding: 40, textAlign: 'center', color: c.textFaint, fontSize: 13 }}>{children}</div>
export const Field = ({ label, children }) => <div style={{ marginBottom: 12 }}><div style={{ fontSize: 11, color: c.textMuted, fontWeight: 500, marginBottom: 5 }}>{label}</div>{children}</div>
export const Section = ({ label, children }) => <div style={{ marginBottom: 18 }}><div style={{ fontSize: 11, color: c.textMuted, fontWeight: 600, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>{children}</div>

export const tcell = (align = 'left') => ({ padding: '10px 12px', textAlign: align, fontSize: 11, color: c.textMuted, fontWeight: 600, letterSpacing: 0.3 })

export function fmtShort(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
export function fmtDateTime(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('zh-HK', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}
