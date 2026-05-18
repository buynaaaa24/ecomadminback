export type AdminPrincipal = {
  sub: string;
  username: string;
  displayName: string;
  role: string;
  tenantId: string | null;
};
