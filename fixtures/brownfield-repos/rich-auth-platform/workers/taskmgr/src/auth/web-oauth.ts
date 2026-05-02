import { createWebSession } from "./web-sessions";

export async function completeGithubOAuth(code: string) {
  return createWebSession(`github:${code}`);
}
