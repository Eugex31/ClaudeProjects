export type Role = "owner" | "editor" | "viewer";
export const canEdit = (role: Role) => role === "owner" || role === "editor";
