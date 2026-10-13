import assert from 'node:assert/strict';
import { buildInvoiceDocument, toPrintableOrder } from '../root-site/bizflow/print/print-invoice.js';
const source={order:{id:'own-test-order',date:'2026/10/13',customer:'Own print test'},detail:{orderNo:'DC129',paymentTotal:290,items:[{name:'Own test product',quantity:2,price:100}],fees:{shipping:40,deposit:60,service:5,discount:-15}}};
const order=toPrintableOrder(source);
let count=0;function check(label,run){run();console.log(`ok ${++count} - ${label}`);}
for (const [name,mode] of [['invoice',{invoice:true,receipt:false}],['receipt',{invoice:false,receipt:true}]]) {
 check(`${name} includes each fee below products and keeps amount due`,()=>{
  const html=buildInvoiceDocument(order,mode);
  for(const label of ['Shipping','Deposit','Service fee','Discount'])assert.ok(html.includes(label));
  assert.ok(html.indexOf('Own test product')<html.indexOf('data-print-fee="shipping"'));
  assert.ok(html.includes('HKD$ 290'));assert.ok(html.includes('>-15</div>'));assert.ok(!html.includes('{{'));
  const rows=[...html.matchAll(/<div class="table-row"[^>]*>\s*<div>(.*?)<\/div>\s*<div>(.*?)<\/div>\s*<div class="col-price">(.*?)<\/div>/g)];
  assert.equal(rows.reduce((sum,row)=>sum+Number(row[2])*Number(row[3].replaceAll(',','')),0),290);
 });
}
check('absent/zero fees produce no empty fee rows',()=>{const html=buildInvoiceDocument({...order,fees:{}},{invoice:true,receipt:false});assert.ok(!html.includes('data-print-fee='));});
check('raw invoice fee items are split once and positive discount is printed negative',()=>{
 const next=toPrintableOrder({items:[{name:'Product',qty:1,price:100},{name:'押金',qty:1,price:60},{name:'優惠',qty:1,price:-10}],paymentTotal:150});
 assert.equal(next.items.length,1);assert.equal(next.fees.deposit,60);assert.equal(next.fees.discount,-10);
 const html=buildInvoiceDocument({...next,fees:{...next.fees,discount:10}},{invoice:false,receipt:true});assert.ok(html.includes('>-10</div>'));assert.equal((html.match(/data-print-fee="deposit"/g)||[]).length,1);
});
console.log(`PRINT_FEES=${count}/${count}`);
