const IMAGE_EXTENSION_ALIASES = Object.freeze({
  "image/jpeg": "jpg",
  "image/svg+xml": "svg"
});

function imageExtension(type) {
  const normalized = String(type || "image/png").split(";", 1)[0].toLocaleLowerCase();
  return IMAGE_EXTENSION_ALIASES[normalized] || normalized.split("/", 2)[1]?.split("+", 1)[0] || "png";
}

function defaultCreateFile(parts, name, options) {
  return new File(parts, name, options);
}

function defaultPreviewUrl(file) {
  return globalThis.URL?.createObjectURL ? globalThis.URL.createObjectURL(file) : "";
}

export function taskFeedbackAttachmentDraft(file, { previewUrlForFile = defaultPreviewUrl } = {}) {
  if (!file) return null;
  const type = String(file.type || "application/octet-stream");
  return {
    file,
    name: String(file.name || "attachment"),
    size: Number(file.size || 0),
    type,
    lastModified: Number(file.lastModified || 0),
    previewUrl: type.startsWith("image/") ? String(previewUrlForFile(file) || "") : ""
  };
}

export function pastedTaskFeedbackImages(clipboardData, {
  now = Date.now(),
  createFile = defaultCreateFile,
  previewUrlForFile = defaultPreviewUrl
} = {}) {
  const items = Array.from(clipboardData?.items ?? []);
  const drafts = [];
  for (const item of items) {
    if (item?.kind !== "file" || !String(item.type || "").startsWith("image/")) continue;
    const blob = item.getAsFile?.();
    if (!blob) continue;
    const type = String(blob.type || item.type || "image/png");
    const file = createFile([blob], `pasted-${now}-${drafts.length}.${imageExtension(type)}`, { type });
    const draft = taskFeedbackAttachmentDraft(file, { previewUrlForFile });
    if (draft) drafts.push(draft);
  }
  return drafts;
}

export function revokeTaskFeedbackAttachmentDrafts(drafts, revoke = globalThis.URL?.revokeObjectURL?.bind(globalThis.URL)) {
  if (!revoke) return;
  for (const draft of drafts ?? []) {
    if (draft?.previewUrl) revoke(draft.previewUrl);
  }
}
