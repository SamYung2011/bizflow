// Central defaults until the support service publishes its configuration.
export const SUPPORT_LIMITS = { voiceMaxSeconds: 60, attachmentMaxMb: 20 };
export const SUPPORT_CATEGORIES = [
  '充電問題', '付款與退款', '訂單問題', '帳號與登入',
  '設備與綁定', '發票與收據', 'APP 使用', '其他問題',
];
export const SUPPORT_PAGE_SIZE = 30;

const systemKeys = { '已转人工客服': '已轉人工客服', '客服已结束本次服务': '客服已結束本次服務', '使用者已结束本次服务': '使用者已結束本次服務' };
export const systemMessageKey = content => systemKeys[content] || content;

export function mergeMessages(current = [], incoming = []) {
  const entries = new Map(current.map(message => [message.clientMsgId || message.id, message]));
  incoming.forEach(message => entries.set(message.clientMsgId || message.id, message));
  return [...entries.values()].sort((a, b) => a.createdAt - b.createdAt || a.id - b.id);
}

export function conversationState(conversation) {
  return conversation.status === 'closed' ? 'closed'
    : conversation.lastSenderRole === 'user' ? 'waiting' : 'active';
}

export function staffName(email, employees) {
  return employees.find(employee => employee.email?.toLowerCase() === email?.toLowerCase())?.name || email;
}
