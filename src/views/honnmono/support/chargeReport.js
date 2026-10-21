const locale = lang => lang === 'zh' ? 'zh-HK' : lang === 'fr' ? 'fr-FR' : 'en-GB';
const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;

export function reportFact(fact, t, lang) {
  const { value, unit } = fact;
  const number = value => new Intl.NumberFormat(locale(lang), { maximumFractionDigits: 2 }).format(value);
  if (unit === 'percent_range') return Array.isArray(value) && value.length === 2 && value.every(v => finite(v) && v <= 100)
    ? `${number(value[0])}% → ${number(value[1])}%` : null;
  if (!finite(value)) return null;
  if (unit === 'datetime') return Number.isFinite(new Date(value).getTime())
    ? new Intl.DateTimeFormat(locale(lang), { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Hong_Kong' }).format(value) : null;
  if (unit === 'duration') return t('{minutes} 分 {seconds} 秒', { minutes: Math.floor(value / 60), seconds: Math.floor(value % 60) });
  const suffix = { kwh: t('度'), kw: 'kW', amps: 'A' }[unit];
  if (!suffix) return null;
  return `${fact.estimated ? `${t('估算約')} ` : ''}${number(value)} ${suffix}`;
}

// Retain original diagnostic data for technical colleagues, outside the main reading flow.
export function readableSupportText(value, t) {
  return String(value || '').replace(/\b(?:flash|self|lufengzhe):[A-Za-z0-9_-]+/g, t('已關聯的充電紀錄'));
}

export function splitSupportText(value, t) {
  const original = String(value || '');
  // Each handoff appends another paragraph. Hide only the diagnostic paragraph,
  // so a later customer's issue stays visible on a reused support conversation.
  const main = original.replace(/(?:^|\r?\n)[ \t]*(?:診斷紀錄|诊断记录)[：:][\s\S]*?(?=\r?\n[ \t]*\r?\n|$)/g, '').trim();
  const text = readableSupportText(main, t);
  return { text: text || t('已附上技術資料，請先了解客戶遇到的情況。'),
    details: text !== original.trim() ? original : '' };
}
