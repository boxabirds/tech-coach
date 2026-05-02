export function validateApiKey(token: string) {
  return token.startsWith("ctx_");
}
