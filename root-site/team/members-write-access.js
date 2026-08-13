// 成員域渲染層的寫閘。原本整頁一個 state.liveReadOnly 硬閘（G-mem-13），
// 現在按 members.js:buildMemberAccess 已有的權限矩陣分項點亮：
// 誰有權編輯就給誰點亮，無權仍 disabled。liveReadOnly 退化成「一項寫權限都沒有」的粗兜底。

export function memberCanWrite(state, capability) {
  return state?.liveReadOnly !== true && state?.access?.[capability] === true;
}

export function memberWriteAttrs(state, capability) {
  return memberCanWrite(state, capability) ? "" : ' disabled aria-disabled="true"';
}
