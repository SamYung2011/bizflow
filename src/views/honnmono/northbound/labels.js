export const STAGES = [
  ['submitted', '已提交 · 等待核對'],
  ['checking', 'Honnmono 核對中'],
  ['filed', '已遞交相關部門'],
  ['inspection', '安排驗車中'],
  ['insurance', '保險處理中'],
  ['result', '官方結果'],
];
export const KINDS = [
  ['vehicle_license', '車輛牌簿'],
  ['cn_driving_license', '中國駕駛執照'],
  ['hrp', '回鄉證'],
  ['driver_doc', '指定司機文件'],
  ['inspection_cert', '驗車紙'],
  ['other', '其他文件'],
];
export const KIND_LABELS = Object.fromEntries(KINDS);
export const STAGE_LABELS = Object.fromEntries(STAGES);
export const TYPE_LABELS = { first: '首次申請', renewal: '續期', reapply: '重新申請' };
export const RESULT_LABELS = { approved: '已批核', rejected: '未獲批准' };
export const TRI_LABELS = { '': '待核對', true: '是', false: '否' };
