// Central defaults until the support service publishes its configuration.
export const SUPPORT_LIMITS = { voiceMaxSeconds: 60, attachmentMaxMb: 20 };
export const SUPPORT_CATEGORIES = [
  '充電問題', '付款與退款', '訂單問題', '帳號與登入',
  '設備與綁定', '發票與收據', 'APP 使用', '其他問題',
];
export const SUPPORT_PAGE_SIZE = 30;

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
