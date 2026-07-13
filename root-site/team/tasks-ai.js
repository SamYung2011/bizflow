import { taskT } from "./tasks-i18n.js";

export function renderTaskAiDialog({ state, helpers }) {
  if (!state.aiOpen) return "";
  const { escapeHtml, lang } = helpers;
  return `<div class="task-ai-overlay" data-task-ai-overlay>
    <section class="task-ai-dialog" role="dialog" aria-modal="true" aria-label="${escapeHtml(taskT(lang, "tasks.ai.title"))}">
      <header><h2>${escapeHtml(taskT(lang, "tasks.ai.title"))}</h2><button type="button" data-task-ai-close aria-label="${escapeHtml(taskT(lang, "tasks.ai.close"))}">×</button></header>
      <div><p>${escapeHtml(taskT(lang, "tasks.ai.description"))}</p><textarea placeholder="${escapeHtml(taskT(lang, "tasks.ai.placeholder"))}"></textarea><span>${escapeHtml(taskT(lang, "tasks.ai.unavailable"))}</span></div>
      <footer><button type="button" data-task-ai-close>${escapeHtml(taskT(lang, "tasks.ai.cancel"))}</button><button type="button" disabled>${escapeHtml(taskT(lang, "tasks.ai.parse"))}</button></footer>
    </section>
  </div>`;
}
