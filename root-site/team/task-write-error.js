export function taskWriteErrorKey(error) {
  return error?.code === "auth_context_timeout"
    ? "tasks.write.authTimeout"
    : "tasks.write.failed";
}
