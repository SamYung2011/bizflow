import { normalizeOrderQuery } from './live-orders-query.js';
import { normalizeCustomerQuery, normalizeWarrantyQuery } from './live-customers-query.js';
import { managementPageSize } from '../components/management-list.js';
import { customerSortKeys } from '../bizflow/customers-sort.js';
import { restoredQueryRange } from '../components/date-range-state.js';

export function orderPageState(value, presets = {}, domainTabs = ['list','northbound','chargerLeads','revenue']) {
  const next = value && typeof value === 'object' ? value : {};
  const shippingFilters = ['all','pending','in_transit','exception','delivered'];
  return {
    tab: domainTabs.includes(next.tab) ? next.tab : domainTabs.includes(presets.tab) ? presets.tab : 'list',
    source: typeof next.source === 'string' ? next.source : 'all',
    shipping: shippingFilters.includes(next.shipping) ? next.shipping : shippingFilters.includes(presets.shipping) ? presets.shipping : 'all',
    search: typeof next.search === 'string' ? next.search : presets.search ?? '',
    sort: ['newest','oldest','amount_desc','amount_asc'].includes(next.sort) ? next.sort : 'newest',
    page: Number.isInteger(next.page) && next.page > 0 ? next.page : 1
  };
}
export function customerPageState(value, presetTab = null) {
  const next = value && typeof value === 'object' ? value : {};
  return {
    tab: ['list','warranty'].includes(next.tab) ? next.tab : presetTab === 'warranty' ? 'warranty' : 'list',
    sort: customerSortKeys.includes(next.sort) ? next.sort : 'createdDesc',
    source: ['all','shopify','framer','other'].includes(next.source) ? next.source : 'all',
    imei: ['all','has','none'].includes(next.imei) ? next.imei : 'all',
    search: typeof next.search === 'string' ? next.search : '',
    page: Number.isInteger(next.page) && next.page > 0 ? next.page : 1
  };
}
export function orderPageQuery(state, range) { return normalizeOrderQuery({ ...state, ...restoredQueryRange(range) }); }
export function customerPageQuery(state, range) {
  return normalizeCustomerQuery({ ...state, ...restoredQueryRange(range), pageSize: managementPageSize() });
}
export function warrantyPageQuery(state = {}) {
  return normalizeWarrantyQuery({ ...state, from: state.dateFrom, to: state.dateTo, pageSize: managementPageSize() });
}
