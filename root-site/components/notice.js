// One floating notice shared by writes and phone copy; messages are supplied by each view's dictionary.
let timer = 0;
let current = null;
export function clearNotice() {
  window.clearTimeout(timer);
  timer = 0;
  current?.remove();
  current = null;
}
export function showNotice(message, tone = 'success') {
  clearNotice();
  const notice = document.createElement('p');
  notice.className = `phone-copy-notice phone-copy-notice--${tone}`;
  notice.dataset.notice = '';
  notice.dataset.phoneCopyNotice = ''; // Keep the existing phone-copy DOM contract.
  notice.setAttribute('role', tone === 'success' ? 'status' : 'alert');
  notice.setAttribute('aria-live', 'polite');
  notice.textContent = message;
  document.body.append(notice);
  current = notice;
  timer = window.setTimeout(clearNotice, 2500);
}
