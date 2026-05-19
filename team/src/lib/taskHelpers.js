import { supabase } from '../supabaseClient.js'

export function isTaskAssignedTo(task, empId, assigneesByTask) {
  const list = assigneesByTask.get(task.id) || []
  if (list.some(a => a.employee_id === empId)) return true
  return list.length === 0 && task.employee_id === empId
}

export function empDoneFor(task, empId, assigneesByTask) {
  const list = assigneesByTask.get(task.id) || []
  const row = list.find(a => a.employee_id === empId)
  if (row) return row.completed_at != null && row.abandoned_at == null
  return task.status === 'done'
}

export function empAbandonedFor(task, empId, assigneesByTask) {
  const list = assigneesByTask.get(task.id) || []
  const row = list.find(a => a.employee_id === empId)
  if (row) return row.abandoned_at != null
  return task.status === 'abandoned'
}

export function isAwaitingApproval(task, assigneesByTask) {
  if (!task.needs_approval) return false
  if (task.approved_at) return false
  if (task.status !== 'open') return false
  const list = assigneesByTask.get(task.id) || []
  if (list.length === 0) return false
  return list.every(a => a.completed_at != null || a.abandoned_at != null)
}

export function getTaskCompanyId(task, assigneesByTask, employees) {
  if (task.company_id) return task.company_id
  const list = assigneesByTask.get(task.id) || []
  for (const a of list) {
    const e = employees.find(x => x.id === a.employee_id)
    if (e?.company_id) return e.company_id
  }
  if (task.creator_employee_id) {
    const cr = employees.find(x => x.id === task.creator_employee_id)
    if (cr?.company_id) return cr.company_id
  }
  return null
}

export async function uploadAttachment(file, taskId) {
  const ext = (file.name.split('.').pop() || 'bin').toLowerCase()
  const path = `${taskId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  const { error } = await supabase.storage.from('task-attachments').upload(path, file, {
    contentType: file.type || 'application/octet-stream',
    upsert: false,
  })
  if (error) throw error
  const { data: pub } = supabase.storage.from('task-attachments').getPublicUrl(path)
  return { url: pub.publicUrl, name: file.name, size: file.size, type: file.type || 'application/octet-stream' }
}
