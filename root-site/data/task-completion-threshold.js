// 批3件C (2026-08-05 煊煊拍板逐字):
//   11:43「嘶。如果设定了负责人，负责人超过80%勾选完成就全部完成吧。」(动机=5 負責人勾 4 没自动收)
//   11:52 追拍「那不坏菜了吗。按比例来！」—— 否掉了纯比例 ≥0.8 在不足 5 人时退化成「必须全勾」的效果。
// 定稿口径: 完成人数 ≥ max(1, Math.round(0.8 × assignee 总数))，四舍五入照 Math.round 标准、不手调
// (0.8N 的小数位只会是 .0/.2/.4/.6/.8，无 .5 歧义)。效果: 1人→1、2人→2、3人→2、4人→3、5人→4、
// 6人→5、7人→6、8人→6、10人→8。
// 分子 = 勾了完成的行(completed_at 非空;放棄行的 completed_at 恒为 null,天然不进分子)。
// 分母 = 全部 assignee 行(含放棄行)。没有負責人(0 行)恒不触发。
// 这是任务与子任务两条「assignee 勾自己那行」写路径共用的唯一阈值定义——别再落第二个 0.8。
export const TASK_COMPLETION_THRESHOLD = 0.8;

export function requiredCompletionCount(totalCount) {
  return Math.max(1, Math.round(TASK_COMPLETION_THRESHOLD * totalCount));
}

export function meetsTaskCompletionThreshold(completedCount, totalCount) {
  return totalCount > 0 && completedCount >= requiredCompletionCount(totalCount);
}
