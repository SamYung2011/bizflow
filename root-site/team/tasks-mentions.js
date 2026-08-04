const closedMentionMenu = () => ({
  open: false,
  query: "",
  atIndex: -1,
  cursor: 0
});

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function createTaskFeedbackDraft() {
  return {
    message: "",
    attachments: [],
    mentions: [],
    mentionMenu: closedMentionMenu()
  };
}

export function taskFeedbackMentionCandidates(members, currentUser) {
  const currentUserId = String(currentUser?.userId || "");
  const seen = new Set();
  return (members ?? []).filter((member) => {
    const userId = String(member?.userId || "");
    const name = String(member?.name || "").trim();
    const active = member?.status === "active" || member?.employmentActive === true;
    if (!userId || !name || !active || member?.dept === "all" || userId === currentUserId || seen.has(userId)) return false;
    seen.add(userId);
    return true;
  });
}

export function findTaskFeedbackMention(message, cursor) {
  const text = String(message || "");
  const caret = Math.max(0, Math.min(Number.isInteger(cursor) ? cursor : text.length, text.length));
  const beforeCaret = text.slice(0, caret);
  const atIndex = beforeCaret.lastIndexOf("@");
  if (atIndex < 0) return null;
  const query = beforeCaret.slice(atIndex + 1);
  if (/\s/u.test(query)) return null;
  return { open: true, query, atIndex, cursor: caret };
}

export function updateTaskFeedbackMentionInput(draft, message, cursor) {
  return {
    ...draft,
    message: String(message || ""),
    mentionMenu: findTaskFeedbackMention(message, cursor) ?? closedMentionMenu()
  };
}

export function closeTaskFeedbackMention(draft) {
  return { ...draft, mentionMenu: closedMentionMenu() };
}

export function selectTaskFeedbackMention(draft, member) {
  const userId = String(member?.userId || "");
  const name = String(member?.name || "").trim();
  const menu = draft?.mentionMenu;
  if (!userId || !name || !menu?.open || menu.atIndex < 0) return null;
  const message = String(draft.message || "");
  const cursor = Math.max(menu.atIndex + 1, Math.min(menu.cursor, message.length));
  const afterCursor = message.slice(cursor);
  const nextMessage = `${message.slice(0, menu.atIndex)}@${name} ${afterCursor.startsWith(" ") ? afterCursor.slice(1) : afterCursor}`;
  const mentions = Array.isArray(draft.mentions) ? draft.mentions : [];
  const nextMentions = mentions.some((mention) => mention.userId === userId)
    ? mentions.slice()
    : [...mentions, { userId, name }];
  return {
    draft: {
      ...draft,
      message: nextMessage,
      mentions: nextMentions,
      mentionMenu: closedMentionMenu()
    },
    cursor: menu.atIndex + name.length + 2
  };
}

// 2026-08-04 煊煊拍板批3件2(截图批注"点击删除@的人之后名字仍然卡在对话框内,应该跟着一起删除"):
// chip 的 × 不再只挪 mentioned 集合——正文里这个成员对应的 @姓名 token 也要一并删掉,不是"移出
// 提到列表但文字原样留着"。用负向前瞻(?![\p{L}\p{N}])挡掉"@Jack"误伤"@Jackson"这类更长姓名的
// 前缀;token 后面紧跟且仅跟一个空格时把那一个空格一并吞掉,不留双空格;同名 token 在正文里出现
// 几次删几次(自动补全允许同一人被选中多次插入,但 mentions 数组本身去重);没有 @ 前缀的手打同名
// 纯文本天然不在匹配范围内,不会被误伤。返回形状对齐 selectTaskFeedbackMention 的 {draft,cursor}——
// 光标落在被删的第一个 token 原来的起始位置(全部删完则落到正文末尾),方便继续编辑。
export function removeTaskFeedbackMention(draft, userId) {
  const mentions = Array.isArray(draft.mentions) ? draft.mentions : [];
  const target = mentions.find((mention) => mention.userId === userId);
  const message = String(draft.message || "");
  let matchOffset = -1;
  const nextMessage = target?.name
    ? message.replace(new RegExp(`@${escapeRegExp(target.name)}(?![\\p{L}\\p{N}])( ?)`, "gu"), (match, _space, offset) => {
      if (matchOffset === -1) matchOffset = offset;
      return "";
    })
    : message;
  return {
    draft: {
      ...draft,
      message: nextMessage,
      mentions: mentions.filter((mention) => mention.userId !== userId),
      mentionMenu: closedMentionMenu()
    },
    cursor: matchOffset === -1 ? nextMessage.length : matchOffset
  };
}
