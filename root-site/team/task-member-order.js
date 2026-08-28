import { memberIdentity } from "./tasks-model.js";

function stableId(value) {
  return String(value ?? "").trim();
}

function memberEmployeeId(member) {
  return member?.id ? stableId(memberIdentity(member)) : "";
}

export function orderedTaskRailMembers(members, currentUser) {
  const source = Array.isArray(members) ? members : [];
  const allIndex = source.findIndex((member) => member?.dept === "all");
  const currentEmployeeId = stableId(currentUser?.employeeId || currentUser?.id);
  const currentUserId = stableId(currentUser?.userId);
  if (allIndex < 0 || (!currentEmployeeId && !currentUserId)) return source.slice();

  const currentIndex = source.findIndex((member) => member?.dept !== "all" && (
    (currentEmployeeId && memberEmployeeId(member) === currentEmployeeId) ||
    (currentUserId && stableId(member?.userId) === currentUserId)
  ));
  if (currentIndex < 0) return source.slice();

  return [
    source[allIndex],
    source[currentIndex],
    ...source.filter((_, index) => index !== allIndex && index !== currentIndex)
  ];
}
