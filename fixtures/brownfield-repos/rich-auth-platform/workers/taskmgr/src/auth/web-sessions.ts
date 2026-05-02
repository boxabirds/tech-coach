export function createWebSession(subject: string) {
  return { subject, cookie: "session" };
}
