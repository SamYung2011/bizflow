const COMMON_EMAIL_DOMAINS = [
  'gmail.com', 'yahoo.com', 'yahoo.com.hk', 'yahoo.com.tw',
  'hotmail.com', 'outlook.com', 'live.com', 'icloud.com', 'me.com',
  'qq.com', '163.com', '126.com', 'foxmail.com', 'sina.com', 'aol.com',
]

function editDistance(a, b) {
  const m = a.length, n = b.length
  if (m === 0) return n
  if (n === 0) return m
  let prev = new Array(n + 1)
  for (let j = 0; j <= n; j++) prev[j] = j
  for (let i = 1; i <= m; i++) {
    const curr = new Array(n + 1)
    curr[0] = i
    for (let j = 1; j <= n; j++) {
      curr[j] = a[i - 1] === b[j - 1] ? prev[j - 1] : 1 + Math.min(prev[j - 1], prev[j], curr[j - 1])
    }
    prev = curr
  }
  return prev[n]
}

// 輸入框 email 拼錯提示：返回最相近的常見域名（edit distance ≤ 2）或 null
export function suggestEmail(val) {
  if (!val) return null
  const v = String(val).trim()
  const at = v.indexOf('@')
  if (at <= 0 || at >= v.length - 1) return null
  const local = v.slice(0, at)
  const domain = v.slice(at + 1).toLowerCase()
  if (COMMON_EMAIL_DOMAINS.includes(domain)) return null
  let best = null, bd = Infinity
  for (const d of COMMON_EMAIL_DOMAINS) {
    const dist = editDistance(domain, d)
    if (dist > 0 && dist < bd && dist <= 2) { bd = dist; best = d }
  }
  return best ? `${local}@${best}` : null
}
