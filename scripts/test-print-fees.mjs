import assert from 'node:assert/strict';
import { buildInvoiceDocument, toPrintableOrder } from '../root-site/bizflow/print/print-invoice.js';
const source={order:{id:'own-test-order',date:'2026/10/13',customer:'Own print test'},detail:{orderNo:'DC129',paymentTotal:290,items:[{name:'Own test product',quantity:2,price:100}],fees:{shipping:40,deposit:60,service:5,discount:-15}}};
const order=toPrintableOrder(source);
let count=0;function check(label,run){run();console.log(`ok ${++count} - ${label}`);}
for (const [name,mode] of [['invoice',{invoice:true,receipt:false}],['receipt',{invoice:false,receipt:true}]]) {
 check(`${name} includes each fee below products and keeps amount due`,()=>{
  const html=buildInvoiceDocument(order,mode);
  for(const label of ['Shipping','押金','手續費','優惠折扣'])assert.ok(html.includes(label));
  assert.ok(html.indexOf('Own test product')<html.indexOf('data-print-fee="shipping"'));
  assert.ok(html.includes('HKD$ 290'));assert.ok(html.includes('>-15</div>'));assert.ok(!html.includes('{{'));
  const rows=[...html.matchAll(/<div class="table-row"[^>]*>\s*<div>(.*?)<\/div>\s*<div>(.*?)<\/div>\s*<div class="col-price">(.*?)<\/div>/g)];
  assert.equal(rows.reduce((sum,row)=>sum+Number(row[2])*Number(row[3].replaceAll(',','')),0),290);
 });
}
check('absent/zero fees produce no empty fee rows',()=>{const html=buildInvoiceDocument({...order,fees:{}},{invoice:true,receipt:false});assert.ok(!html.includes('data-print-fee='));});
check('normalized detail items and fees are used directly; positive discount prints negative',()=>{
 const items=[{name:'Own ordinary product containing deposit in its name',quantity:1,price:100}];
 const next=toPrintableOrder({detail:{items,fees:{deposit:60,discount:10},paymentTotal:150}});
 assert.equal(next.items,items);assert.equal(next.fees.deposit,60);
 const html=buildInvoiceDocument(next,{invoice:false,receipt:true});assert.ok(html.includes('>-10</div>'));assert.equal((html.match(/data-print-fee="deposit"/g)||[]).length,1);
 assert.ok(html.includes(items[0].name));
});
console.log(`PRINT_FEES=${count}/${count}`);
