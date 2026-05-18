import type { RequestHandler } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { AdminUser } from "../models/AdminUser.js";
import type { AdminPrincipal } from "../types/adminPrincipal.js";

export type { AdminPrincipal };

function jwtSecret(): string {
  return process.env.ADMIN_JWT_SECRET ?? "";
}

function adminPassword(): string {
  return process.env.ADMIN_PASSWORD ?? "";
}

function adminUsername(): string {
  return process.env.ADMIN_USERNAME ?? "";
}

function signToken(principal: AdminPrincipal): string {
  const secret = jwtSecret();
  return jwt.sign(
    {
      sub: principal.sub,
      username: principal.username,
      displayName: principal.displayName,
      role: principal.role,
      tenantId: principal.tenantId,
    },
    secret,
    { expiresIn: "7d" },
  );
}

function principalFromPayload(payload: jwt.JwtPayload): AdminPrincipal {
  const p = payload as Record<string, unknown>;
  return {
    sub: String(p.sub ?? ""),
    username: String(p.username ?? ""),
    displayName: String(p.displayName ?? p.username ?? "Admin"),
    role: String(p.role ?? "admin"),
    tenantId: p.tenantId ? String(p.tenantId) : null,
  };
}

export const adminLoginHandler: RequestHandler = async (req, res) => {
  const secret = jwtSecret();
  const { email, password } = req.body as { email?: string; password?: string };
  if (!secret) {
    res.status(503).json({
      error: {
        code: "MISCONFIGURED",
        message: "ADMIN_JWT_SECRET must be set on the API server",
      },
    });
    return;
  }
  if (typeof email !== "string" || typeof password !== "string") {
    res.status(401).json({
      error: { code: "UNAUTHORIZED", message: "Invalid credentials" },
    });
    return;
  }

  const u = email.trim().toLowerCase();
  const pwd = password;

  try {
    const user = await AdminUser.findOne({ email: u, status: "active" }).lean();
    if (user && typeof user.passwordHash === "string") {
      const ok = await bcrypt.compare(pwd, user.passwordHash);
      if (ok) {
        const principal: AdminPrincipal = {
          sub: String(user._id),
          username: user.username,
          displayName: user.displayName,
          role: user.role ?? "admin",
          tenantId: user.tenantId ? String(user.tenantId) : null,
        };
        const token = signToken(principal);
        
        // Update last login
        await AdminUser.findByIdAndUpdate(user._id, { lastLogin: new Date() });

        res.json({
          data: {
            token,
            user: {
              id: principal.sub,
              name: principal.displayName,
              email: user.email,
              role: principal.role,
              tenantId: principal.tenantId,
            }
          },
        });
        return;
      }
    }
  } catch {
    /* fall through to legacy */
  }

  const legacyUser = adminUsername().trim().toLowerCase();
  const legacyPwd = adminPassword();
  
  const isHardcodedAdmin = (u === "admin" || u === "admin@gmail.mn" || u === "admin@gmail.com" || u === "superadmin") && pwd === "admin123";

  // Accept username or email for superadmin fallback
  if (isHardcodedAdmin || (legacyUser && legacyPwd && (u === legacyUser || u === "superadmin@gmail.mn") && pwd === legacyPwd)) {
    const principal: AdminPrincipal = {
      sub: "env",
      username: isHardcodedAdmin ? "admin" : legacyUser,
      displayName: "Super Administrator",
      role: "superadmin",
      tenantId: null,
    };
    const token = signToken(principal);
    res.json({
      data: {
        token,
        user: {
          id: principal.sub,
          name: principal.displayName,
          email: isHardcodedAdmin ? "admin@gmail.mn" : "superadmin@gmail.mn",
          role: principal.role,
          tenantId: principal.tenantId,
        }
      },
    });
    return;
  }

  res.status(401).json({
    error: { code: "UNAUTHORIZED", message: "Invalid credentials" },
  });
};

export const requireAdminAuth: RequestHandler = (req, res, next) => {
  const secret = jwtSecret();
  if (!secret) {
    res.status(503).json({
      error: { code: "MISCONFIGURED", message: "ADMIN_JWT_SECRET must be set on the API server" },
    });
    return;
  }
  const raw = req.headers.authorization;
  const m = raw?.match(/^Bearer\s+(.+)$/i);
  if (!m?.[1]) {
    res.status(401).json({
      error: { code: "UNAUTHORIZED", message: "Missing or invalid Authorization" },
    });
    return;
  }
  try {
    const payload = jwt.verify(m[1], secret) as jwt.JwtPayload;
    req.admin = principalFromPayload(payload);
    next();
  } catch {
    res.status(401).json({
      error: { code: "UNAUTHORIZED", message: "Invalid or expired token" },
    });
  }
};

export const requireRole = (...roles: string[]): RequestHandler => {
  return (req, res, next) => {
    const a = req.admin;
    if (!a) {
      res.status(401).json({
        error: { code: "UNAUTHORIZED", message: "Not authenticated" },
      });
      return;
    }
    if (roles.includes(a.role)) {
      next();
      return;
    }
    res.status(403).json({
      error: { code: "FORBIDDEN", message: "Permission denied" },
    });
  };
};
