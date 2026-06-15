// team/api/parse-tasks.js
// Vercel Serverless Function：用戶丟一段文案 → DeepSeek 解析成多條任務候選 → 返回給前端預覽
//
// 流程：
// 1. 驗 Authorization Bearer <supabase access token>
// 2. 查 caller 所在公司是否 feature_ai_batch=true
// 3. service role 拉 wa_settings.openai_api_key + openai_base_url + model（單一 key 來源 = bizflow）
// 4. 構造 prompt（含部門列表）+ 強制 JSON 返回
// 5. 調 DeepSeek（OpenAI 兼容 /chat/completions）
// 6. sanitize 後回前端
//
// env vars（team Vercel project 必須配）：
// - SUPABASE_URL（或 fallback VITE_SUPABASE_URL）
// - SUPABASE_SERVICE_ROLE_KEY

import { createClient } from '@supabase/supabase-js'

export const config = { maxDuration: 60 }

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method not allowed' })
  }

  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return res.status(500).json({ error: 'serverless env not configured' })
  }

  const { text, companyId } = (typeof req.body === 'string' ? safeJSON(req.body) : req.body) || {}
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'text required' })
  }
  if (text.length > 20000) {
    return res.status(400).json({ error: 'text too long (max 20000 chars)' })
  }

  const auth = req.headers.authorization || ''
  if (!auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'no auth' })
  }
  const token = auth.slice(7)

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data: userData, error: userErr } = await admin.auth.getUser(token)
  if (userErr || !userData?.user) {
    return res.status(401).json({ error: 'invalid token' })
  }
  const userId = userData.user.id

  const { data: emp } = await admin
    .from('employees')
    .select('id, name')
    .eq('user_id', userId)
    .maybeSingle()
  if (!emp) {
    return res.status(403).json({ error: 'no employee binding' })
  }
  const meName = (emp.name || '').trim() || '當前用戶'

  const { data: bindings } = await admin
    .from('employee_companies')
    .select('company_id')
    .eq('employee_id', emp.id)
  const companyIds = (bindings || []).map(b => b.company_id)
  if (companyIds.length === 0) {
    return res.status(403).json({ error: 'no company binding' })
  }

  const { data: enabledCompanies } = await admin
    .from('companies')
    .select('id, name, feature_ai_batch')
    .in('id', companyIds)
    .eq('feature_ai_batch', true)
  if (!enabledCompanies || enabledCompanies.length === 0) {
    return res.status(403).json({ error: 'feature not enabled for your company' })
  }
  const enabledCompanyIds = enabledCompanies.map(c => c.id)
  const requestedCompanyId = typeof companyId === 'string' && companyId.trim() ? companyId.trim() : null
  if (requestedCompanyId && !enabledCompanyIds.includes(requestedCompanyId)) {
    return res.status(403).json({ error: 'feature not enabled for selected company' })
  }
  const scopeCompanyIds = requestedCompanyId ? [requestedCompanyId] : enabledCompanyIds

  const { data: depts } = await admin
    .from('departments')
    .select('name')
    .in('company_id', scopeCompanyIds)
  const deptNames = [...new Set((depts || []).map(d => d.name).filter(Boolean))]

  const { data: coBindings } = await admin
    .from('employee_companies')
    .select('employee_id, employees!inner(name)')
    .in('company_id', scopeCompanyIds)
  const colleagueNames = [...new Set(
    (coBindings || [])
      .map(b => b.employees?.name?.trim())
      .filter(name => name && name !== meName)
  )]

  const { data: settings, error: setErr } = await admin
    .from('wa_settings')
    .select('openai_api_key, openai_base_url, model')
    .eq('id', 1)
    .maybeSingle()
  if (setErr || !settings?.openai_api_key) {
    return res.status(500).json({ error: 'AI key not configured' })
  }

  const baseUrl = (settings.openai_base_url || 'https://api.deepseek.com').replace(/\/+$/, '')
  const model = settings.model || 'deepseek-chat'

  const today = ymdInTimeZone(new Date(), 'Asia/Hong_Kong')
  const sysPrompt = `你是任務整理助手。用戶會給你一段非結構化文案（會議記錄、待辦清單、群聊截圖文字等），請拆解成獨立的任務項。

當前操作者：${meName}
- 文案中的「我」「咱」「咱們」一律指代 ${meName}
- description 中**必須**把這些代詞替換成「${meName}」，方便他人閱讀；不要保留「我」「咱」這類第一人稱

同公司同事名單（文案中可能出現的人名）：${colleagueNames.length ? colleagueNames.join('、') : '無'}
- 文案出現的人名如果在這個列表裡，保留為該名字（不要改寫、不要意譯）
- 不在列表的人名（例如「sam 哥」「老板」「客戶 KC」等外部人物或代稱）原樣保留即可

可選部門列表（如果無法確定就填 null）：${deptNames.length ? deptNames.join(' / ') : '無'}

優先級規則：
- high：緊急 / 關鍵 / deadline 在本週內 / 帶「急」「立刻」「ASAP」字眼
- mid：常規任務（默認）
- low：可延期 / 探索性 / 「有空看看」

截止日期：
- 文案中明確出現的日期（"周五"、"6月10日"、"本月底"等）按今天往後推算成 YYYY-MM-DD
- 沒提到留 null
- 今天是 ${today}

返回格式：必須是合法 JSON，不要 markdown 圍籬，不要其他文字。Schema：
{"tasks": [{"title": "...", "description": "...", "department_name": "..." | null, "due_date": "YYYY-MM-DD" | null, "priority": "high" | "mid" | "low"}]}

title 簡短（≤30 字），description 寫清楚「誰做什麼、為什麼」（不要光是抄文案，把代詞換成名字）。`

  let upstream
  try {
    upstream = await fetch(baseUrl + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + settings.openai_api_key,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: sysPrompt },
          { role: 'user', content: text },
        ],
        max_tokens: 8192,
        response_format: { type: 'json_object' },
      }),
    })
  } catch (e) {
    return res.status(502).json({ error: 'upstream network: ' + e.message })
  }

  const d = await upstream.json().catch(() => ({}))
  if (!upstream.ok) {
    return res.status(502).json({ error: `upstream ${upstream.status}: ${d.error?.message || JSON.stringify(d).slice(0, 200)}` })
  }

  const content = d.choices?.[0]?.message?.content
  if (!content) {
    return res.status(502).json({ error: 'empty response from model' })
  }

  const parsed = safeJSON(content)
  if (!parsed || !Array.isArray(parsed.tasks)) {
    return res.status(502).json({ error: 'model returned invalid JSON: ' + String(content).slice(0, 200) })
  }

  const clean = parsed.tasks
    .map(item => ({
      title: String(item?.title || '').trim().slice(0, 100),
      description: String(item?.description || '').trim().slice(0, 2000),
      department_name: item?.department_name && deptNames.includes(item.department_name) ? item.department_name : null,
      due_date: /^\d{4}-\d{2}-\d{2}$/.test(item?.due_date) ? item.due_date : null,
      priority: ['high', 'mid', 'low'].includes(item?.priority) ? item.priority : 'mid',
    }))
    .filter(t => t.title)

  return res.status(200).json({ tasks: clean })
}

function safeJSON(str) {
  try { return JSON.parse(str) } catch { return null }
}

function ymdInTimeZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const part = (type) => parts.find(p => p.type === type)?.value
  return `${part('year')}-${part('month')}-${part('day')}`
}
