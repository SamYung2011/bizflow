export function openTaskUnlessTextSelected(event, task, setEditingTask, beforeOpen) {
  if (event?.target?.tagName === 'INPUT') return
  if (typeof window !== 'undefined' && window.getSelection?.().toString()) return
  beforeOpen?.()
  setEditingTask(task)
}
