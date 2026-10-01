export const TYPES = [
  ['policy', '保單核對'], ['claim', '出險個案'], ['enquiry', '報價詢價'],
];
export const POLICY_STATUS = {
  uploaded: '整理中', ready: '已整理', unreadable: '未能讀取',
  superseded: '已取代', removed: '已移除',
};
export const CLAIM_STATUS = {
  draft: '草稿 · 尚未提交', submitted: '已提交 · 等待接收',
  received: 'Honnmono 核對中', insurer_accepted: '保險公司受理中',
  assessing: '查勘／定損中', result: '已結案', cancelled: '已取消',
};
export const CLAIM_STAGES = [
  ['submitted', '整理事故資料'], ['received', 'Honnmono 接收與核對'],
  ['insurer_accepted', '保險公司受理'], ['assessing', '查勘／定損與理賠'],
  ['result', '賠付或結案結果'], ['cancelled', '已取消'],
];
export const CLAIM_RESULTS = [['paid', '已賠付'], ['denied', '未獲賠付'], ['closed', '已結案']];
export const ENQUIRY_STATUS = {
  submitted: '已提出 · 等待分派代理', assigned: '代理處理中',
  need_info: '代理需要補充資料', quoted: '報價已到', done: '已完成', cancelled: '已取消',
};
export const DOC_KINDS = [
  ['policy_doc', '保單文件'], ['scene_photo', '事故相片'], ['repair_quote', '維修報價'],
  ['police_doc', '警方文件'], ['other', '其他文件'],
];
export const NCD = { unknown: '不清楚' };
export const CLAIMS_RECORD = {
  none: '過去三年沒有', one: '過去三年一次',
  two_or_more: '過去三年兩次或以上', unknown: '不清楚',
};
export const labelFor = (type, status) => ({ policy: POLICY_STATUS, claim: CLAIM_STATUS,
  enquiry: ENQUIRY_STATUS })[type]?.[status] || status || '—';
