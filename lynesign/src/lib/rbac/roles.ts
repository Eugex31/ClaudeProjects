import { Role } from "@prisma/client";

export const ROLE_RANK: Record<Role, number> = {
  OWNER: 5, ADMIN: 4, MANAGER: 3, CONTENT_MANAGER: 2, VIEWER: 1,
};

export const ASSIGNABLE_ROLES: Role[] = [Role.ADMIN, Role.MANAGER, Role.CONTENT_MANAGER, Role.VIEWER];
