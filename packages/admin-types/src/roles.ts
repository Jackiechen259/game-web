/** Three roles (section 20). Viewer < Editor < Admin. */

export type Role = "viewer" | "editor" | "admin";

export const ROLE_RANK: Record<Role, number> = {
  viewer: 0,
  editor: 1,
  admin: 2,
};

export const ALL_ROLES: ReadonlyArray<Role> = ["viewer", "editor", "admin"];

/** True if `userRole` meets or exceeds `required`. */
export function hasRole(userRole: Role | undefined, required: Role): boolean {
  if (!userRole) return false;
  return ROLE_RANK[userRole] >= ROLE_RANK[required];
}

export const ROLE_PERMISSIONS = {
  viewer: ["read"],
  editor: ["read", "write", "upload", "validate", "preview"],
  admin: ["read", "write", "upload", "validate", "preview", "publish", "rollback", "settings", "manage-users"],
} as const;

export type Permission = (typeof ROLE_PERMISSIONS)[Role][number];

export function can(userRole: Role | undefined, permission: Permission): boolean {
  if (!userRole) return false;
  return (ROLE_PERMISSIONS[userRole] as readonly string[]).includes(permission);
}
