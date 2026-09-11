import { peekNavigationPreset as peek, navigationPresetKeys as keys } from '../components/navigation-presets.js';
import { orderPageState, orderPageQuery, customerPageState, customerPageQuery, warrantyPageQuery } from './page-query-state.js';
import { prefetchOrdersPage } from './live-orders-query.js';
import { prefetchCustomersPage, prefetchWarrantyPage } from './live-customers-query.js';
import { prefetchLiveUnreadState, prefetchLiveHomeDashboard } from './live-home-query.js';

export function prefetchPageData(page, { historyState = null } = {}) {
  const reads = [prefetchLiveUnreadState()];
  if (page === 'home') {
    reads.push(prefetchLiveHomeDashboard());
  } else if (page === 'orders') {
    const state = orderPageState(historyState, { tab: peek(keys.ordersTab), shipping: peek(keys.ordersShipping), search: peek(keys.ordersSearch) ?? '' });
    reads.push(prefetchOrdersPage(orderPageQuery(state, historyState?.dateFilter)));
  } else if (page === 'customers') {
    const state = customerPageState(historyState, peek(keys.customersTab));
    reads.push(prefetchCustomersPage(customerPageQuery(state, historyState?.dateFilter)));
    if (state.tab === 'warranty') {
      const warranty = historyState?.warranty ?? { search: !historyState ? peek(keys.warrantySearch) ?? '' : '' };
      reads.push(prefetchWarrantyPage(warrantyPageQuery(warranty)));
    }
  } else if (['expense', 'whatsapp', 'inventory'].includes(page)) {
    reads.push(import('./live-snapshots.js').then(({ prefetchLiveSnapshot }) => prefetchLiveSnapshot(`${page}.json`)));
  }
  // Speculation never owns page notices, route activation or navigation state.
  return Promise.allSettled(reads);
}
