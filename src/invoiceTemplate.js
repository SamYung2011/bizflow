// 发票打印模板 —— 按 Figma 定稿 A4-4 (node 11:65)
// Figma 文件: https://www.figma.com/design/niCLYUWrN53424Cjn3hQk9
//
// 自适应版：items 多时浏览器自然流动分页。加了 break-inside 规则尽量避免：
//   - 单行 items 被切在两页之间
//   - Footer 区块被切开
//   - AMOUNT / THANK YOU 和上面的表格或 Footer 被孤立切分
//
// Placeholder:
//   {{subject_line}} {{date}}
//   {{customer_name}} {{customer_phone}} {{customer_email}} {{customer_address}}
//   {{car_make}} {{car_model}}
//   {{Total_Sum}}
//   {{invoice_rows}}   ← 动态生成 N 行 <div class="table-row">
import { logoDataUrl, sloganDataUrl, fbDataUrl, igDataUrl } from "./invoiceAssets";

export const INVOICE_TEMPLATE =
'<!DOCTYPE html>\n' +
'<html lang="zh-HK">\n' +
'<head>\n' +
'<meta charset="UTF-8">\n' +
'<title>INVOICE</title>\n' +
'<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Noto+Sans+SC:wght@400;500;700&family=Noto+Sans+JP:wght@400;500;700&display=swap">\n' +
'<style>\n' +
'  @page { size: A4; margin: 0; }\n' +
'  * { box-sizing: border-box; }\n' +
'  html, body { margin: 0; padding: 0; }\n' +
'  body {\n' +
'    font-family: "Inter", "Noto Sans SC", "Noto Sans JP", sans-serif;\n' +
'    color: #000;\n' +
'    background: #fff;\n' +
'    -webkit-print-color-adjust: exact;\n' +
'    print-color-adjust: exact;\n' +
'  }\n' +
'  .page {\n' +
'    width: 210mm;\n' +
'    max-width: 100%;\n' +
'    margin: 0 auto;\n' +
'    padding: 20px 30px;\n' +
'    display: flex;\n' +
'    flex-direction: column;\n' +
'    gap: 10px;\n' +
'  }\n' +
'  .logo-block {\n' +
'    padding: 20px 0;\n' +
'    display: flex;\n' +
'    flex-direction: column;\n' +
'    align-items: center;\n' +
'    justify-content: center;\n' +
'    gap: 6px;\n' +
'  }\n' +
'  .logo { width: 56.472px; height: 36.923px; }\n' +
'  .slogan { width: 162.193px; height: 9.231px; }\n' +
'  .title-block {\n' +
'    padding: 10px 0;\n' +
'    display: flex;\n' +
'    flex-direction: column;\n' +
'    gap: 10px;\n' +
'  }\n' +
'  .title {\n' +
'    font-weight: 700;\n' +
'    font-size: 24px;\n' +
'    line-height: 29px;\n' +
'  }\n' +
'  .title-meta {\n' +
'    font-weight: 500;\n' +
'    font-size: 11px;\n' +
'    line-height: 16.5px;\n' +
'    display: flex;\n' +
'    flex-direction: column;\n' +
'    gap: 4px;\n' +
'  }\n' +
'  .hr-line {\n' +
'    border: none;\n' +
'    border-top: 2px solid #000;\n' +
'    margin: 0;\n' +
'    width: 100%;\n' +
'  }\n' +
'  .info-row {\n' +
'    display: flex;\n' +
'    gap: 20px;\n' +
'    padding: 10px 0 30px;\n' +
'  }\n' +
'  .info-col {\n' +
'    flex: 1 0 263.5px;\n' +
'    display: flex;\n' +
'    flex-direction: column;\n' +
'    gap: 20px;\n' +
'  }\n' +
'  .info-label {\n' +
'    font-weight: 700;\n' +
'    font-size: 16px;\n' +
'  }\n' +
'  .info-body {\n' +
'    font-weight: 500;\n' +
'    font-size: 11px;\n' +
'    line-height: 16.5px;\n' +
'    display: flex;\n' +
'    flex-direction: column;\n' +
'    gap: 2px;\n' +
'    word-break: break-word;\n' +
'  }\n' +
'  .info-body .name { font-weight: 700; }\n' +
'  .table-block {\n' +
'    padding-bottom: 10px;\n' +
'    display: flex;\n' +
'    flex-direction: column;\n' +
'  }\n' +
'  .table-head {\n' +
'    background: #d9d9d9;\n' +
'    border-radius: 10px;\n' +
'    padding: 10px;\n' +
'    display: flex;\n' +
'    gap: 20px;\n' +
'    font-weight: 600;\n' +
'    font-size: 16px;\n' +
'    justify-content: center;\n' +
'  }\n' +
'  .table-head > div { flex: 1 0 0; }\n' +
'  .col-price { text-align: center; }\n' +
'  .table-body {\n' +
'    padding: 0 5px;\n' +
'    font-weight: 500;\n' +
'    font-size: 11px;\n' +
'    line-height: 16.5px;\n' +
'  }\n' +
'  .table-row {\n' +
'    display: flex;\n' +
'    gap: 20px;\n' +
'    padding: 10px 0;\n' +
'    border-bottom: 1px solid #d9d9d9;\n' +
'    align-items: center;\n' +
'    justify-content: center;\n' +
'    break-inside: avoid;\n' +
'    page-break-inside: avoid;\n' +
'  }\n' +
'  .table-row > div { flex: 1 0 0; word-break: break-word; }\n' +
'  .amount-block {\n' +
'    padding: 10px 0 40px;\n' +
'    display: flex;\n' +
'    flex-direction: column;\n' +
'    gap: 10px;\n' +
'    align-items: flex-end;\n' +
'    width: 100%;\n' +
'    break-inside: avoid;\n' +
'    page-break-inside: avoid;\n' +
'  }\n' +
'  .amount {\n' +
'    width: 100%;\n' +
'    padding: 0 10px;\n' +
'    font-weight: 700;\n' +
'    font-size: 16px;\n' +
'    text-align: right;\n' +
'    white-space: pre-wrap;\n' +
'  }\n' +
'  .payment {\n' +
'    display: flex;\n' +
'    justify-content: flex-end;\n' +
'    gap: 10px;\n' +
'    padding: 0 20px;\n' +
'    font-weight: 500;\n' +
'    font-size: 11px;\n' +
'    white-space: nowrap;\n' +
'  }\n' +
'  .footer-block {\n' +
'    padding: 20px;\n' +
'    display: flex;\n' +
'    flex-direction: column;\n' +
'    gap: 10px;\n' +
'    break-inside: avoid;\n' +
'    page-break-inside: avoid;\n' +
'  }\n' +
'  .footer-row {\n' +
'    display: flex;\n' +
'    gap: 20px;\n' +
'    align-items: flex-start;\n' +
'  }\n' +
'  .footer-info {\n' +
'    flex: 1 0 0;\n' +
'    font-weight: 400;\n' +
'    font-size: 8px;\n' +
'    line-height: 12px;\n' +
'    display: flex;\n' +
'    flex-direction: column;\n' +
'  }\n' +
'  .footer-info p { margin: 0; }\n' +
'  .footer-social {\n' +
'    display: flex;\n' +
'    flex-direction: column;\n' +
'    gap: 4px;\n' +
'  }\n' +
'  .footer-social-label {\n' +
'    font-weight: 700;\n' +
'    font-size: 11px;\n' +
'    line-height: 16.5px;\n' +
'  }\n' +
'  .footer-social-icons {\n' +
'    display: flex;\n' +
'    gap: 40px;\n' +
'    align-items: center;\n' +
'  }\n' +
'  .footer-social-icons a,\n' +
'  .footer-social-icons img {\n' +
'    width: 50px;\n' +
'    height: 50px;\n' +
'    display: block;\n' +
'  }\n' +
'  .footer-note {\n' +
'    font-size: 8px;\n' +
'    line-height: 16.5px;\n' +
'    font-weight: 400;\n' +
'  }\n' +
'  .footer-note p { margin: 0; }\n' +
'  .thanks {\n' +
'    padding: 20px 0;\n' +
'    height: 56px;\n' +
'    font-weight: 500;\n' +
'    font-size: 16px;\n' +
'    text-align: center;\n' +
'    display: flex;\n' +
'    align-items: center;\n' +
'    justify-content: center;\n' +
'    break-before: avoid;\n' +
'    page-break-before: avoid;\n' +
'  }\n' +
'</style>\n' +
'</head>\n' +
'<body>\n' +
'<div class="page">\n' +
'  <div class="logo-block">\n' +
'    <img class="logo" src="' + logoDataUrl + '" alt="HONNMONO">\n' +
'    <img class="slogan" src="' + sloganDataUrl + '" alt="SPECIALIST OF EV CHARGING">\n' +
'  </div>\n' +
'  <div class="title-block">\n' +
'    <div class="title">I N V O I C E # DC{{subject_line}}</div>\n' +
'    <div class="title-meta">\n' +
'      <div>ISSUED : {{date}}</div>\n' +
'      <div>DUE ON RECEIPT</div>\n' +
'    </div>\n' +
'  </div>\n' +
'  <hr class="hr-line">\n' +
'  <div class="info-row">\n' +
'    <div class="info-col">\n' +
'      <div class="info-label">BILL TO :</div>\n' +
'      <div class="info-body">\n' +
'        <div class="name">{{customer_name}}</div>\n' +
'        <div>{{customer_phone}}</div>\n' +
'        <div>{{customer_email}}</div>\n' +
'        <div>{{customer_address}}</div>\n' +
'      </div>\n' +
'    </div>\n' +
'    <div class="info-col">\n' +
'      <div class="info-label">CAR DETAIL :</div>\n' +
'      <div class="info-body">\n' +
'        <div>{{car_make}}</div>\n' +
'        <div>{{car_model}}</div>\n' +
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
'      {{invoice_rows}}\n' +
'    </div>\n' +
'  </div>\n' +
'  <div class="amount-block">\n' +
'    <div class="amount">A M O U N T \u00a0 \u00a0 D U E : HKD$ {{Total_Sum}}</div>\n' +
'    <div class="payment">\n' +
'      <div>Payment Info 支付方法 :</div>\n' +
'      <div>FPS/Bank Transfer /PayMe</div>\n' +
'    </div>\n' +
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
'</div>\n' +
'</body>\n' +
'</html>';
