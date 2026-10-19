import React, { useEffect, useRef } from 'react';

export function revealNotice(node) {
  if (!node) return;
  const rect = node.getBoundingClientRect();
  let top = 0, bottom = window.innerHeight, left = 0, right = window.innerWidth;
  for (let parent = node.parentElement; parent; parent = parent.parentElement) {
    const style = window.getComputedStyle(parent), bounds = parent.getBoundingClientRect();
    if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) { top = Math.max(top, bounds.top); bottom = Math.min(bottom, bounds.bottom); }
    if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) { left = Math.max(left, bounds.left); right = Math.min(right, bounds.right); }
  }
  if (rect.top < top || rect.bottom > bottom || rect.left < left || rect.right > right) {
    node.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }
}

export default function SaveNotice({ message }) {
  const ref = useRef(null);
  useEffect(() => { if (message) revealNotice(ref.current); }, [message]);
  return message ? <p ref={ref} role="status" className="knowledge-notice">{message}</p> : null;
}
