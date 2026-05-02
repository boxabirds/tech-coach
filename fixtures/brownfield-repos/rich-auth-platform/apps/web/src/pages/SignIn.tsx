import { githubLoginUrl } from "../../../../workers/taskmgr/src/auth/github-urls";

export function SignIn() {
  return <a href={githubLoginUrl()}>Sign in with GitHub</a>;
}
