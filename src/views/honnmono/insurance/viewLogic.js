export function claimActiveStep(status, steps) {
  if (status === 'cancelled') return -1;
  if (status === 'submitted') return 1;
  return steps.findIndex(([code]) => code === status);
}

export function enquiryEventTitle(event) {
  if (event.type === 'quote') return '發出報價';
  if (event.type === 'info_request') return '要求補充資料';
  if (event.actor === 'user' && event.stage === 'cancelled') return '使用者取消詢價';
  if (event.actor === 'user' && event.payload?.fields?.length) return '使用者補充資料';
  if (event.actor === 'user') return '提交詢價';
  return ({ assigned: '分派代理', done: '標記完成', cancelled: '取消詢價' })[event.stage] || '代理跟進';
}

export function fillEmptyPolicyFields(current, previous) {
  return Object.fromEntries(Object.entries(current).map(([key, value]) =>
    [key, key === 'note' || value !== '' && value != null ? value : previous[key] ?? '']));
}
