const closedMentionMenu = () => ({
  open: false,
  query: "",
  atIndex: -1,
  cursor: 0
});

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

export function removeTaskFeedbackMention(draft, userId) {
  return {
    ...draft,
    mentions: (draft.mentions ?? []).filter((mention) => mention.userId !== userId),
    mentionMenu: closedMentionMenu()
  };
}
