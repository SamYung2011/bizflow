// 收据打印模板 —— 按 Figma A4-5 (node 76:2)
// Figma 文件: https://www.figma.com/design/niCLYUWrN53424Cjn3hQk9?node-id=76-2
//
// 作为发票的第二页嵌入同一个 window 打印，样式 class 复用 invoiceTemplate.js 的 CSS。
// 区别：页首多一个 .receipt-page，CSS 里用 page-break-before: always 强制从新页开始。
//
// Placeholder:
//   {{r_subject_line}} {{r_date}}
//   {{r_customer_name}} {{r_customer_phone}} {{r_customer_email}} {{r_customer_address}}
//   {{r_car_make}} {{r_car_model}}
//   {{r_Total_Sum}}
//   {{r_rows}}
import { logoDataUrl, sloganDataUrl, fbDataUrl, igDataUrl } from "./invoiceAssets";

export const RECEIPT_FRAGMENT =
'<div class="page receipt-page">\n' +
'  <div class="logo-block">\n' +
'    <img class="logo" src="' + logoDataUrl + '" alt="HONNMONO">\n' +
'    <img class="slogan" src="' + sloganDataUrl + '" alt="SPECIALIST OF EV CHARGING">\n' +
'  </div>\n' +
'  <div class="title-block">\n' +
'    <div class="title">R E C E I P T</div>\n' +
'    <div class="title"># DC 收據編號 {{r_subject_line}}</div>\n' +
'    <div class="title-meta">\n' +
'      <div>ISSUED : {{r_date}}</div>\n' +
'    </div>\n' +
'  </div>\n' +
'  <hr class="hr-line">\n' +
'  <div class="info-row">\n' +
'    <div class="info-col">\n' +
'      <div class="info-label">BILL TO :</div>\n' +
'      <div class="info-body">\n' +
'        <div class="name">{{r_customer_name}}</div>\n' +
'        <div>{{r_customer_phone}}</div>\n' +
'        <div>{{r_customer_email}}</div>\n' +
'        <div>{{r_customer_address}}</div>\n' +
'      </div>\n' +
'    </div>\n' +
'    <div class="info-col">\n' +
'      <div class="info-label">CAR DETAIL :</div>\n' +
'      <div class="info-body">\n' +
'        <div>{{r_car_make}}</div>\n' +
'        <div>{{r_car_model}}</div>\n' +
'      </div>\n' +
'    </div>\n' +
'  </div>\n' +
'  <hr class="hr-line">\n' +
'  <div class="table-block">\n' +
'    <div class="table-head">\n' +
'      <div>DESCRIPTION</div>\n' +
'      <div>QUANTITY</div>\n' +
'      <div class="col-price">PRICE</div>\n' +
'    </div>\n' +
'    <div class="table-body">\n' +
'      {{r_rows}}\n' +
'    </div>\n' +
'  </div>\n' +
'  <div class="amount-block">\n' +
'    <div class="amount">A M O U N T \u00a0 \u00a0 D U E : HKD$ {{r_Total_Sum}}</div>\n' +
'  </div>\n' +
'  <hr class="hr-line">\n' +
'  <div class="footer-block">\n' +
'    <div class="footer-row">\n' +
'      <div class="footer-info">\n' +
'        <p>Honnmono Intl Ltd</p>\n' +
'        <p>Room 1516, 15/F, New Commerce Ctr, Shek Mun, Sha TIn, HK</p>\n' +
'        <p>WhatsApp：+852 5633 3057</p>\n' +
'        <p>Office Website：www.honnmono.shop</p>\n' +
'        <p>Email：business@honnmono-store.com</p>\n' +
'      </div>\n' +
'      <div class="footer-social">\n' +
'        <div class="footer-social-label">Follow US</div>\n' +
'        <div class="footer-social-icons">\n' +
'          <a href="https://www.facebook.com/Honnmono.jp" target="_blank" rel="noopener">\n' +
'            <img src="' + fbDataUrl + '" alt="Facebook">\n' +
'          </a>\n' +
'          <a href="https://instagram.com/honnmono_international?igshid=MmIzYWVlNDQ5Yg==" target="_blank" rel="noopener">\n' +
'            <img src="' + igDataUrl + '" alt="Instagram">\n' +
'          </a>\n' +
'        </div>\n' +
'      </div>\n' +
'    </div>\n' +
'    <div class="footer-note">\n' +
'      <p>GBTtoCSS2轉插提供為期2年的保修服務，並包含定期軟件升級服務。</p>\n' +
'      <p>請密切留意Facebook和官方網站上相關消息的更新。</p>\n' +
'    </div>\n' +
'  </div>\n' +
'  <div class="thanks">THANK YOU FOR YOUR BUSINESS !</div>\n' +
'</div>';
