export const PROMPT_LEAVE_EVENT = 'bizflow-app-prompts-leave';

export function requestPromptLeave(target = window) {
  return target.dispatchEvent(new target.Event(PROMPT_LEAVE_EVENT, { cancelable: true }));
}
