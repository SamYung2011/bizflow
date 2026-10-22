import chargeReportFixture from '../../scripts/fixtures/support-charge-report.json';
import { SUPPORT_CATEGORIES, SUPPORT_LIMITS, conversationState } from './supportConfig.js';

const baseTime = new Date('2026-09-17T09:42:00+08:00').getTime();
let nextId = 1000;
let settings = { delay: 450, sendDelay: 1800, failNext: false };
const clone = value => structuredClone(value);
const wait = (ms = settings.delay) => new Promise(resolve => setTimeout(resolve, ms));
const threads = new Map();
const attempts = new Set();
const uploads = new Map();

function message(conversationId, senderRole, content, extra = {}) {
  return { id: nextId++, conversationId, senderRole, content, msgType: 'text',
    attachments: [], senderName: senderRole === 'staff' ? 'mia@example.test' : null,
    createdAt: baseTime, clientMsgId: null, ...extra };
}

function illustration(index) {
  const colors = ['#bdd2c9', '#b6c4da', '#dec9bb', '#c3c6de', '#d8d3b7', '#c7d9db', '#bcd5c3', '#d9c5cb', '#c9d0de'];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360" viewBox="0 0 480 360"><rect width="480" height="360" fill="${colors[index]}"/><path d="M0 260L480 205V360H0Z" fill="#f4f6f7"/><rect x="174" y="60" width="118" height="226" rx="18" fill="#fcfcfc"/><rect x="189" y="80" width="88" height="65" rx="6" fill="#354d55"/><path d="M233 88l-17 28h14l-7 23 26-32h-16z" fill="#b6e1c8"/><rect x="205" y="166" width="53" height="8" rx="4" fill="#d0d9dc"/><path d="M287 150q65 0 60 88t-39 11" fill="none" stroke="#4d5960" stroke-width="10" stroke-linecap="round"/><rect x="301" y="224" width="16" height="37" rx="5" fill="#4d5960"/><circle cx="234" cy="242" r="9" fill="#91b3a2"/><text x="24" y="329" fill="#536268" font-family="sans-serif" font-size="18">HONNMONO · ${String(index + 1).padStart(2, '0')}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function voiceSample() {
  const rate = 8000, seconds = 12, count = rate * seconds;
  const bytes = new ArrayBuffer(44 + count * 2), view = new DataView(bytes);
  const write = (offset, value) => [...value].forEach((letter, index) => view.setUint8(offset + index, letter.charCodeAt(0)));
  write(0, 'RIFF'); view.setUint32(4, 36 + count * 2, true); write(8, 'WAVE'); write(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true);
  view.setUint16(34, 16, true); write(36, 'data'); view.setUint32(40, count * 2, true);
  for (let index = 0; index < count; index++) view.setInt16(44 + index * 2,
    Math.sin(index / rate * Math.PI * 440) * 1600 * (Math.sin(index / rate * Math.PI * 2) ** 8), true);
  return URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
}
let audioUrl;
const people = [
  ['Alex Chan', '66001001', 'ai_handoff', 0, 'open'],
  ['Sophie Wong', '66001002', 'manual', 1, 'open'],
  ['Daniel Lee', '66001003', 'manual', 4, 'open'],
  ['Emma Lam', '66001004', 'feedback', 3, 'open'],
  ['Ryan Ho', '66001005', 'manual', 2, 'closed'],
];
const conversations = people.map(([userNickname, userPhone, source, category, status], index) => ({
  id: index + 1, userId: 800 + index, userNickname, userPhone: `+852 ${userPhone}`,
  userEmail: `${userNickname.split(' ')[0].toLowerCase()}@example.test`, source, status,
  category: SUPPORT_CATEGORIES[category], summary: index === 0
    ? 'The car stopped charging at 42%. The customer expected 80%. Please check the car’s charging limit and any on-screen messages.' : null,
  assigneeEmail: index === 2 ? 'mia@example.test' : '', staffReadMsgId: 0,
  userReadMsgId: 0, createdAt: baseTime - 86400000, closedAt: status === 'closed' ? baseTime : null,
  lastMessageAt: baseTime - index * 60000, lastSenderRole: index === 4 ? 'system' : index === 2 ? 'staff' : 'user',
  lastMessagePreview: '', unreadCount: index === 2 || index === 4 ? 0 : index === 0 ? 3 : 1,
}));

conversations.push({ ...conversations[0], id: 6, status: 'closed', source: 'manual', summary: null,
  category: SUPPORT_CATEGORIES[1], lastMessageAt: baseTime - 86400000 * 7, unreadCount: 0,
  assigneeEmail: 'mia@example.test', lastSenderRole: 'staff' });
threads.set(6, [message(6, 'user', 'My previous charging receipt is now correct.'),
  message(6, 'staff', 'The receipt has been corrected. Thank you, Alex.')]);

threads.set(1, [
  message(1, 'user', 'Why did charging stop before 80%?', { createdAt: baseTime - 300000 }),
  message(1, 'ai', 'The car stopped charging at 42%. Please check the charging limit set in your car.', { createdAt: baseTime - 270000 }),
  message(1, 'user', 'Please connect me with support.', { createdAt: baseTime - 240000 }),
  message(1, 'system', '已轉人工客服', { msgType: 'system', createdAt: baseTime - 180000 }),
  message(1, 'user', 'Customer submitted a northbound application HM-NB-000124', { msgType: 'customer_action', supportAction: { version: 1, kind: 'northbound', action: 'submitted', reference: 'HM-NB-000124', occurredAt: baseTime - 600000, staffAdvice: ['請到相應業務頁面核對已提交資料，告知客戶下一步及是否需要補件。'] } }),
  message(1, 'ai', 'Charging session report', { msgType: 'charge_report', chargeReport: chargeReportFixture.full }),
]);
threads.set(2, [
  message(2, 'user', 'Here are the photos and receipt from the station.', { createdAt: baseTime - 180000 }),
  message(2, 'user', '', { msgType: 'image', createdAt: baseTime - 120000,
    attachments: Array.from({ length: 9 }, (_, index) => ({ cfid: `photo-${index}`, url: illustration(index),
      thumbUrl: illustration(index), name: `station-${index + 1}.svg`, mime: 'image/svg+xml', size: 184000 })) }),
  message(2, 'user', '', { msgType: 'voice', createdAt: baseTime - 60000,
    attachments: [{ cfid: 'voice-1', name: 'station-note.wav', mime: 'audio/wav', duration: 12, size: 192044 }] }),
  message(2, 'user', '', { msgType: 'file', attachments: [{ cfid: 'receipt-1', name: 'charging-receipt.txt',
    mime: 'text/plain', size: 120, url: 'data:text/plain;charset=utf-8,Honnmono%20demo%20receipt%0AOrder%3A%20HM202609170028%0AAmount%3A%20HKD%2028.00' }] }),
]);
threads.set(3, [
  ...Array.from({ length: 65 }, (_, index) => message(3, index % 2 ? 'staff' : 'user',
    index % 2 ? `Device check ${index + 1}: connection looks stable.` : `Device update ${index + 1}: sharing the connection status.`,
    { createdAt: baseTime - (70 - index) * 60000 })),
  message(3, 'staff', 'Your adapter is connected. I’m checking the firmware version now.'),
]);
threads.set(4, [message(4, 'user', 'Hello, I need help updating my phone number.')]);
threads.set(5, [
  message(5, 'user', 'Could you help me find my charging order?', { createdAt: baseTime - 600000 }),
  message(5, 'staff', 'Of course. Your order is HM202609160081.', { createdAt: baseTime - 500000 }),
  message(5, 'user', 'Found it, thank you!', { createdAt: baseTime - 400000 }),
  message(5, 'system', '客服已結束本次服務', { msgType: 'system' }),
]);
conversations.forEach(conversation => {
  const messages = threads.get(conversation.id);
  conversation.lastMessagePreview = messages.at(-1).content || '[attachment]';
  conversation.staffReadMsgId = messages[Math.max(0, messages.length - conversation.unreadCount - 1)].id;
});

export function configureMock(options) {
  settings = { ...settings, ...options };
  if (options.historyCount) {
    for (let index = 2; index < options.historyCount; index++) {
      const id = 100 + index;
      if (conversations.some(row => row.id === id)) continue;
      conversations.push({ ...conversations[5], id, lastMessageAt: baseTime - 86400000 * (index + 6) });
      threads.set(id, [message(id, 'user', `Previous conversation ${index + 1}`)]);
    }
  }
}
export async function listConversations({ status = 'all', filter, userId, page = 1, size = 30, q = '' } = {}) {
  await wait();
  return clone(conversations.filter(item => (status === 'all' || item.status === status)
    && (!userId || item.userId === Number(userId))
    && (filter !== 'waiting_staff' || conversationState(item) === 'waiting')
    && `${item.userNickname} ${item.userPhone} ${item.userEmail} ${customerNotes.get(item.userId)?.text || ""}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => b.lastMessageAt - a.lastMessageAt).slice((page - 1) * size, page * size));
}
export async function getConversation(id) {
  await wait(); return { ...clone(conversations.find(item => item.id === id)), limits: SUPPORT_LIMITS };
}
export async function listMessages(id, { afterId = 0, beforeId, limit = 30 } = {}) {
  await wait();
  const matches = threads.get(id).filter(item => item.id > afterId && (!beforeId || item.id < beforeId));
  const messages = afterId ? matches.slice(0, limit) : matches.slice(-limit);
  const conversation = conversations.find(item => item.id === id);
  conversation.staffReadMsgId = Math.max(conversation.staffReadMsgId, ...messages.map(item => item.id));
  conversation.unreadCount = threads.get(id).filter(item => item.senderRole === 'user' && item.id > conversation.staffReadMsgId).length;
  return clone(messages);
}
function append(id, entry) {
  const conversation = conversations.find(item => item.id === id);
  threads.get(id).push(entry);
  Object.assign(conversation, { lastMessagePreview: entry.content || '[attachment]', lastMessageAt: entry.createdAt,
    lastSenderRole: entry.senderRole, unreadCount: entry.senderRole === 'user' ? conversation.unreadCount + 1 : 0 });
  return clone(entry);
}
export async function sendMessage(id, body, options = {}) {
  await wait(settings.sendDelay);
  const existing = threads.get(id).find(item => item.clientMsgId === body.clientMsgId);
  if (existing) return clone(existing);
  if (settings.failNext || body.content.includes('/fail') && !attempts.has(body.clientMsgId)) {
    settings.failNext = false; attempts.add(body.clientMsgId); throw new Error('Demo connection interrupted');
  }
  const conversation = conversations.find(item => item.id === id);
  if (conversation.status === 'closed') throw new Error('Conversation closed');
  const saved = append(id, message(id, 'staff', body.content, { ...body, senderName: options.operatorEmail || 'mia@example.test', createdAt: Date.now() }));
  conversation.assigneeEmail = saved.senderName;
  return saved;
}
export async function updateConversation(id, { category } = {}) {
  await wait(); const conversation = conversations.find(item => item.id === id);
  if (category !== undefined) conversation.category = category;
  return clone(conversation);
}
export async function closeConversation(id) {
  await wait(); const conversation = conversations.find(item => item.id === id);
  if (conversation.status !== 'closed') append(id, message(id, 'system', '客服已結束本次服務', { msgType: 'system', createdAt: Date.now() }));
  Object.assign(conversation, { status: 'closed', closedAt: Date.now() }); return clone(conversation);
}
export async function fileUrl(attachment) {
  await wait(100);
  const source = attachment.cfid === 'voice-1' ? (audioUrl ||= voiceSample()) : attachment.url || uploads.get(attachment.cfid);
  return URL.createObjectURL(await (await fetch(source)).blob());
}
export async function uploadAttachment(id, file) {
  await wait(750);
  const cfid = `mock-${id}-${nextId++}`, url = URL.createObjectURL(file);
  uploads.set(cfid, url);
  return { cfid, url, thumbUrl: file.type.startsWith('image/') ? url : undefined,
    name: file.name, size: file.size, mime: file.type };
}
export function receiveMockMessage(id) {
  return append(id, message(id, 'user', 'One more update: I’m available if you need anything else.', { createdAt: Date.now() }));
}

const customerNotes = new Map();
const emptyNote = () => ({ text: '', revision: 0, updatedAt: null, updatedBy: '' });
export async function searchUsers({ q = '', page = 1, size = 30 } = {}) {
  await wait();
  const users = [...new Map(conversations.map(row => [row.userId, { id: row.userId, nickname: row.userNickname,
    email: row.userEmail, phone: row.userPhone, phoneHk: row.userPhone.replace('+852 ', ''), phoneCn: '13800138000',
    appmodel: 'honnmono-hk', registeredAt: baseTime - 86400000 * 365, lastLoginAt: baseTime }])).values()];
  users.push({ id: 99001, nickname: 'Registered User', email: 'registered@example.test', phone: '', appmodel: 'honnmono', registeredAt: baseTime });
  users.forEach(user => { user.staffNote = customerNotes.get(user.id) || emptyNote(); });
  const matches = users.filter(row => [row.nickname, row.email, row.phone, row.phoneHk, row.phoneCn, row.id, row.staffNote.text].join(' ').toLowerCase().includes(q.trim().toLowerCase()));
  return clone({ items: matches.slice((page - 1) * size, page * size), page, size, total: matches.length });
}
export async function getUserProfile(id) {
  const basic = (await searchUsers()).items.find(row => row.id === Number(id));
  if (!basic) throw new Error('User not found');
  if (Number(id) === 99001) return clone({ basic, staffNote: customerNotes.get(Number(id)) || emptyNote(), conversations: [], cars: [], adapters: [],
    appDevices: { lastLogin: null, lastMessage: null }, insurance: { overview: null, policies: { hk: null, cn: null, history: [] } }, northbound: { overview: null, cases: [] } });
  return clone({ basic, staffNote: customerNotes.get(Number(id)) || emptyNote(), conversations: await listConversations({ userId: id, size: 5 }),
    cars: [{ id: 51, brand: 'BYD', series: 'Seal', variant: 'Premium', year: '2025', plate: 'AB 1234', vin: 'DEMO-VIN-000051',
      isPrimary: true, checkTime: baseTime + 86400000 * 100, licenseExpireTime: baseTime + 86400000 * 180, intlPlateExpireTime: 0 }],
    appDevices: {
      lastLogin: { deviceModel: 'iPhone 17 Pro', osName: 'iOS', osVersion: '26.1', appVersion: '2.0.1', at: baseTime },
      lastMessage: { deviceModel: 'iPhone 16', osName: 'iOS', osVersion: '26.0', appVersion: '2.0.0', at: baseTime - 3600000 } },
    adapters: [{ imei: '860000000000051', certid: '0D000051', bindtime: baseTime - 86400000 * 10, vin: 'DEMO-VIN-000051',
      fwversion: '1.0.9', carModel: 'Seal', origin: 'flash', lastSeenAt: baseTime }],
    insurance: { overview: null, policies: { hk: { id: 21, policyNo: 'HK-DEMO-0021', insurer: 'Demo Insurance', status: 'ready', coverEnd: '2027-09-17' }, cn: null, history: [] } },
    northbound: { overview: null, cases: [{ id: 71, caseNo: 'HM-NB-000071', status: 'checking' }] } });
}

export async function updateUserProfile(id, body, options = {}) {
  await wait();
  await getUserProfile(id);
  const previous = customerNotes.get(Number(id)) || emptyNote();
  if (body.revision !== previous.revision) { const error = new Error('Conflict'); error.status = 409; throw error; }
  const staffNote = { text: body.note.trim(), revision: previous.revision + 1, updatedAt: Date.now(), updatedBy: options.operatorEmail || 'staff@example.test' };
  customerNotes.set(Number(id), staffNote);
  return clone({ staffNote });
}
