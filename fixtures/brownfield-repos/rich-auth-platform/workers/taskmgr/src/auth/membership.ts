export type ProjectRole = "owner" | "editor" | "viewer";

export function canAccessProject(role: ProjectRole) {
  return role === "owner" || role === "editor" || role === "viewer";
}
