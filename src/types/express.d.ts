import type { AdminPrincipal } from "./adminPrincipal.js";

declare global {
  namespace Express {
    interface Request {
      admin?: AdminPrincipal;
    }
  }
}

export {};
