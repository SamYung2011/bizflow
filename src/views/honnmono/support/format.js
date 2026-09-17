const locale = lang => lang === 'zh' ? 'zh-HK' : lang === 'fr' ? 'fr-FR' : 'en-GB';
export const formatTime = (value, lang) => new Intl.DateTimeFormat(locale(lang), {
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Hong_Kong',
}).format(value);
export const formatDate = (value, lang) => new Intl.DateTimeFormat(locale(lang), {
  month: 'long', day: 'numeric', timeZone: 'Asia/Hong_Kong',
}).format(value);
export const dayKey = value => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong' }).format(value);
export const fileSize = bytes => bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
