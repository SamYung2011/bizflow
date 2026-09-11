import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import * as utils from '../../root-site/data/live-snapshot-utils.js';
import { buildCustomerGroups } from '../../root-site/data/customer-groups.js';
import { customerSourceFromInvoices } from '../../root-site/data/customer-source.js';
// Use the actual unchanged snapshot and legacy detail functions as the oracle.
export async function legacyCustomerDetails(rows) {
  const source=readFileSync(new URL('../../root-site/data/live-snapshots.js',import.meta.url),'utf8');
  const provider=readFileSync(new URL('../../root-site/data/provider.js',import.meta.url),'utf8');
  const extract=(text,name)=>{
    const found=text.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n}`));
    if(!found)throw new Error(`Missing legacy oracle ${name}`);
    return found[0];
  };
  const functions=['dedupeInvoices','invoiceNumber','invoiceChannel','normalizedInvoiceItems','customerOrder','customerSourceData','buildCustomersSnapshot'].map(name=>extract(source,name));
  functions.push(extract(provider,'customerSnapshotGroups'));
  const api=vm.runInNewContext(functions.join('\n')+';({buildCustomersSnapshot,customerSnapshotGroups})',{
    ...utils,buildCustomerGroups,customerSourceFromInvoices,
    allRows:async(table,key,ascending=true)=>[...rows[table]].sort((a,b)=>String(a[key]??'').localeCompare(String(b[key]??''))*(ascending?1:-1))
  });
  const snapshot=await api.buildCustomersSnapshot();
  const plain=value=>JSON.parse(JSON.stringify(value));
  return{snapshot:plain(snapshot.customers),detail:plain(api.customerSnapshotGroups(snapshot.customers)),scoped:plain(snapshot.customers.map(row=>({...api.customerSnapshotGroups([row])[0],groupCids:row.groupCids})))};
}
