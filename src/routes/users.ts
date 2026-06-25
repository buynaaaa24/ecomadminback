import { Router } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { sendSms } from "../util/sms.js";
import { CustomerUser } from "../models/CustomerUser.js";
import { Tenant } from "../models/Tenant.js";
import { Order } from "../models/Order.js";
import { getOrderModel } from "../models/orderSchema.js";
import { getTenantConnection } from "../db.js";
import { serializeLean } from "../util/serialize.js";

// ── OTP in-memory store ──────────────────────────────────────────────────────
const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes
const otpStore = new Map<string, { code: string; expiresAt: number; tenantId: string | null }>();

function generateOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function otpKey(phone: string, tenantId: string | null): string {
  return `${tenantId ?? "null"}:${phone}`;
}

export const usersRouter = Router();

// ── Helpers ─────────────────────────────────────────────────────────────────

function accessSecret(): string {
  return process.env.CUSTOMER_JWT_SECRET ?? process.env.ADMIN_JWT_SECRET ?? "customer-secret";
}

function refreshSecret(): string {
  return process.env.CUSTOMER_REFRESH_SECRET ?? process.env.ADMIN_JWT_SECRET ?? "customer-refresh";
}

function signAccess(userId: string): string {
  return jwt.sign({ sub: userId, type: "customer" }, accessSecret(), { expiresIn: "15m" });
}

function signRefresh(userId: string): string {
  return jwt.sign({ sub: userId, type: "customer_refresh" }, refreshSecret(), { expiresIn: "7d" });
}

function verifyAccess(token: string): { sub: string } | null {
  try {
    const p = jwt.verify(token, accessSecret()) as jwt.JwtPayload;
    if (p.type !== "customer") return null;
    return { sub: String(p.sub) };
  } catch {
    return null;
  }
}

/** Extract Bearer token from Authorization header */
function extractBearer(authHeader?: string): string | null {
  const m = authHeader?.match(/^Bearer\s+(.+)$/i);
  return m?.[1] ?? null;
}

/** Resolve the tenantId from the request (X-Tenant-Id header or query param). */
function resolveTenantId(req: any): string | null {
  const h = req.headers["x-tenant-id"] as string | undefined;
  const q = req.query?.tenantId as string | undefined;
  return h ?? q ?? null;
}

/** Resolve the Order model for a tenant (dedicated DB or central). */
async function resolveOrderModel(tenantId: string | null) {
  if (tenantId) {
    const tenant = await Tenant.findById(tenantId).lean<{ databaseUri?: string }>();
    const uri = tenant?.databaseUri;
    if (uri && (uri.startsWith("mongodb://") || uri.startsWith("mongodb+srv://"))) {
      const conn = await getTenantConnection(uri);
      return { Model: getOrderModel(conn), useTenantFilter: false };
    }
  }
  return { Model: Order, useTenantFilter: true };
}

// ── POST /api/users/otp/send ─────────────────────────────────────────────────

usersRouter.post("/otp/send", async (req, res, next) => {
  try {
    const { phone } = req.body as { phone?: string };
    if (!phone) {
      res.status(400).json({ error: "Утасны дугаар шаардлагатай" });
      return;
    }
    const tenantId = resolveTenantId(req);
    const code = generateOtp();
    const key = otpKey(phone.trim(), tenantId);
    otpStore.set(key, { code, expiresAt: Date.now() + OTP_TTL_MS, tenantId });

    try {
      await sendSms(phone.trim(), `Таны нэвтрэх OTP код: ${code}. 5 минутын дараа хүчингүй болно.`);
    } catch (smsErr: any) {
      console.error("[OTP] SMS send failed:", smsErr.message);
      res.status(502).json({ error: "SMS илгээхэд алдаа гарлаа" });
      return;
    }

    console.log(`[OTP] Sent to ${phone} (tenantId=${tenantId})`);
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

// ── POST /api/users/otp/verify ───────────────────────────────────────────────

usersRouter.post("/otp/verify", async (req, res, next) => {
  try {
    const { phone, code, firstName, lastName } = req.body as {
      phone?: string;
      code?: string;
      firstName?: string;
      lastName?: string;
    };

    if (!phone || !code) {
      res.status(400).json({ error: "Утасны дугаар болон OTP код шаардлагатай" });
      return;
    }

    const tenantId = resolveTenantId(req);
    const key = otpKey(phone.trim(), tenantId);
    const entry = otpStore.get(key);

    if (!entry || entry.code !== code.trim()) {
      res.status(401).json({ error: "OTP код буруу байна" });
      return;
    }
    if (Date.now() > entry.expiresAt) {
      otpStore.delete(key);
      res.status(401).json({ error: "OTP кодны хугацаа дууссан байна" });
      return;
    }
    otpStore.delete(key);

    // Find or create user by phone
    let user = await CustomerUser.findOne({
      tenantId: tenantId ? new mongoose.Types.ObjectId(tenantId) : null,
      phone: phone.trim(),
    });

    if (!user) {
      // Auto-register with phone
      const tmpHash = await bcrypt.hash(generateOtp(), 10);
      user = await CustomerUser.create({
        tenantId: tenantId ? new mongoose.Types.ObjectId(tenantId) : null,
        phone: phone.trim(),
        email: `${phone.trim()}@phone.local`,
        passwordHash: tmpHash,
        firstName: firstName?.trim() || phone.trim(),
        lastName: lastName?.trim() || "",
        refreshTokens: [],
      });
    }

    if (user.status !== "active") {
      res.status(403).json({ error: "Бүртгэл түр хаагдсан байна" });
      return;
    }

    const accessToken = signAccess(String(user._id));
    const newRefresh = signRefresh(String(user._id));
    const tokens = (user.refreshTokens ?? []).slice(-4);
    tokens.push(newRefresh);
    await CustomerUser.findByIdAndUpdate(user._id, { refreshTokens: tokens, lastLogin: new Date() });

    res.json({
      accessToken,
      refreshToken: newRefresh,
      user: {
        id: String(user._id),
        email: user.email,
        phone: user.phone,
        firstName: user.firstName,
        lastName: user.lastName,
      },
    });
  } catch (e) {
    next(e);
  }
});

// ── POST /api/users/register ─────────────────────────────────────────────────

usersRouter.post("/register", async (req, res, next) => {
  try {
    const { email, phone, password, firstName, lastName } = req.body as {
      email?: string;
      phone?: string;
      password?: string;
      firstName?: string;
      lastName?: string;
    };

    if (!password || (!email && !phone)) {
      res.status(400).json({ error: "Утасны дугаар эсвэл и-мэйл болон нууц үг шаардлагатай" });
      return;
    }
    if (password.length < 6) {
      res.status(400).json({ error: "Нууц үг хамгийн багадаа 6 тэмдэгт байх ёстой" });
      return;
    }

    const tenantId = resolveTenantId(req);
    const resolvedPhone = phone?.trim() ?? "";
    const emailLower = (email?.trim() || `${resolvedPhone}@phone.local`).toLowerCase();
    const resolvedFirstName = firstName?.trim() || resolvedPhone;
    const resolvedLastName = lastName?.trim() || "";

    const existing = await CustomerUser.findOne({
      tenantId: tenantId ? new mongoose.Types.ObjectId(tenantId) : null,
      $or: [
        { email: emailLower },
        ...(resolvedPhone ? [{ phone: resolvedPhone }] : []),
      ],
    });
    if (existing) {
      res.status(409).json({ error: "Энэ утас/и-мэйлээр бүртгэл аль хэдийн байна" });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await CustomerUser.create({
      tenantId: tenantId ? new mongoose.Types.ObjectId(tenantId) : null,
      email: emailLower,
      phone: resolvedPhone,
      passwordHash,
      firstName: resolvedFirstName,
      lastName: resolvedLastName,
      refreshTokens: [],
    });

    const accessToken = signAccess(String(user._id));
    const newRefresh = signRefresh(String(user._id));

    await CustomerUser.findByIdAndUpdate(user._id, { $push: { refreshTokens: newRefresh } });

    res.status(201).json({
      accessToken,
      refreshToken: newRefresh,
      user: {
        id: String(user._id),
        email: user.email,
        phone: user.phone,
        firstName: user.firstName,
        lastName: user.lastName,
      },
    });
  } catch (e) {
    next(e);
  }
});

// ── POST /api/users/login ────────────────────────────────────────────────────

usersRouter.post("/login", async (req, res, next) => {
  try {
    const { email, phone, password } = req.body as {
      email?: string;
      phone?: string;
      password?: string;
    };

    if (!password || (!email && !phone)) {
      res.status(400).json({ error: "email эсвэл phone болон password шаардлагатай" });
      return;
    }

    const tenantId = resolveTenantId(req);
    const filter: Record<string, unknown> = {
      tenantId: tenantId ? new mongoose.Types.ObjectId(tenantId) : null,
    };

    if (email) {
      filter.email = email.trim().toLowerCase();
    } else {
      filter.phone = phone!.trim();
    }

    const user = await CustomerUser.findOne(filter);
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      res.status(401).json({ error: "И-мэйл/утас эсвэл нууц үг буруу байна" });
      return;
    }

    if (user.status !== "active") {
      res.status(403).json({ error: "Бүртгэл түр хаагдсан байна" });
      return;
    }

    const accessToken = signAccess(String(user._id));
    const newRefresh = signRefresh(String(user._id));

    // Keep max 5 refresh tokens per user
    const tokens = (user.refreshTokens ?? []).slice(-4);
    tokens.push(newRefresh);
    await CustomerUser.findByIdAndUpdate(user._id, {
      refreshTokens: tokens,
      lastLogin: new Date(),
    });

    res.json({
      accessToken,
      refreshToken: newRefresh,
      user: {
        id: String(user._id),
        email: user.email,
        phone: user.phone,
        firstName: user.firstName,
        lastName: user.lastName,
      },
    });
  } catch (e) {
    next(e);
  }
});

// ── POST /api/users/refresh ──────────────────────────────────────────────────

usersRouter.post("/refresh", async (req, res, next) => {
  try {
    const { refreshToken } = req.body as { refreshToken?: string };
    if (!refreshToken) {
      res.status(401).json({ error: "refreshToken шаардлагатай" });
      return;
    }

    let payload: jwt.JwtPayload;
    try {
      payload = jwt.verify(refreshToken, refreshSecret()) as jwt.JwtPayload;
      if (payload.type !== "customer_refresh") throw new Error();
    } catch {
      res.status(401).json({ error: "Refresh token хүчингүй эсвэл хугацаа дууссан" });
      return;
    }

    const user = await CustomerUser.findById(payload.sub);
    if (!user || !(user.refreshTokens ?? []).includes(refreshToken)) {
      res.status(401).json({ error: "Refresh token олдсонгүй" });
      return;
    }

    const accessToken = signAccess(String(user._id));
    const newRefresh = signRefresh(String(user._id));

    const tokens = (user.refreshTokens ?? [])
      .filter((t: string) => t !== refreshToken)
      .slice(-4);
    tokens.push(newRefresh);
    await CustomerUser.findByIdAndUpdate(user._id, { refreshTokens: tokens });

    res.json({ accessToken, refreshToken: newRefresh });
  } catch (e) {
    next(e);
  }
});

// ── GET /api/users/me ────────────────────────────────────────────────────────

usersRouter.get("/me", async (req, res, next) => {
  try {
    const token = extractBearer(req.headers.authorization);
    if (!token) {
      res.status(401).json({ error: "Нэвтрэх шаардлагатай" });
      return;
    }
    const payload = verifyAccess(token);
    if (!payload) {
      res.status(401).json({ error: "Token хүчингүй" });
      return;
    }
    const user = await CustomerUser.findById(payload.sub).lean();
    if (!user) {
      res.status(404).json({ error: "Хэрэглэгч олдсонгүй" });
      return;
    }
    res.json({
      id: String((user as any)._id),
      email: user.email,
      phone: user.phone,
      firstName: user.firstName,
      lastName: user.lastName,
    });
  } catch (e) {
    next(e);
  }
});

// ── GET /api/users/orders ────────────────────────────────────────────────────

usersRouter.get("/orders", async (req, res, next) => {
  try {
    const token = extractBearer(req.headers.authorization);
    if (!token) {
      res.status(401).json({ error: "Нэвтрэх шаардлагатай" });
      return;
    }
    const payload = verifyAccess(token);
    if (!payload) {
      res.status(401).json({ error: "Token хүчингүй" });
      return;
    }

    const user = await CustomerUser.findById(payload.sub).lean<{
      _id: unknown; email: string; phone: string; tenantId?: unknown;
    }>();
    if (!user) {
      res.status(404).json({ error: "Хэрэглэгч олдсонгүй" });
      return;
    }

    const tenantId = user.tenantId ? String(user.tenantId) : null;
    const { Model: OrderModel, useTenantFilter } = await resolveOrderModel(tenantId);

    const filter: Record<string, unknown> = {
      $or: [
        { "customerInfo.email": user.email },
        ...(user.phone ? [{ "customerInfo.phone": user.phone }] : []),
      ],
    };
    if (useTenantFilter && tenantId) {
      filter.tenantId = new mongoose.Types.ObjectId(tenantId);
    }

    const orders = await OrderModel.find(filter).sort({ createdAt: -1 }).limit(50).lean();
    res.json({ data: orders.map((o) => serializeLean(o as Record<string, unknown>)) });
  } catch (e) {
    next(e);
  }
});

// ── PATCH /api/users/me ───────────────────────────────────────────────────────

usersRouter.patch("/me", async (req, res, next) => {
  try {
    const token = extractBearer(req.headers.authorization);
    if (!token) { res.status(401).json({ error: "Нэвтрэх шаардлагатай" }); return; }
    const payload = verifyAccess(token);
    if (!payload) { res.status(401).json({ error: "Token хүчингүй" }); return; }

    const { firstName, lastName, email, phone } = req.body as {
      firstName?: string; lastName?: string; email?: string; phone?: string;
    };
    const update: Record<string, string> = {};
    if (firstName?.trim()) update.firstName = firstName.trim();
    if (lastName?.trim()) update.lastName = lastName.trim();
    if (email?.trim()) update.email = email.trim().toLowerCase();
    if (phone?.trim()) update.phone = phone.trim();

    const user = await CustomerUser.findByIdAndUpdate(
      payload.sub, { $set: update }, { new: true }
    ).lean();
    if (!user) { res.status(404).json({ error: "Хэрэглэгч олдсонгүй" }); return; }

    res.json({
      id: String((user as any)._id),
      email: user.email,
      phone: user.phone,
      firstName: user.firstName,
      lastName: user.lastName,
    });
  } catch (e) {
    next(e);
  }
});

// ── GET /api/users/ebarimt/:orderNumber ──────────────────────────────────────

usersRouter.get("/ebarimt/:orderNumber", async (req, res, next) => {
  try {
    const token = extractBearer(req.headers.authorization);
    if (!token) { res.status(401).json({ error: "Нэвтрэх шаардлагатай" }); return; }
    const payload = verifyAccess(token);
    if (!payload) { res.status(401).json({ error: "Token хүчингүй" }); return; }

    const { orderNumber } = req.params;
    const { Ebarimt } = await import("../models/Ebarimt.js");
    const doc = await Ebarimt.findOne({ orderNumber }).lean();
    if (!doc) { res.status(404).json({ error: "Эбаримт олдсонгүй" }); return; }

    res.json(serializeLean(doc as Record<string, unknown>));
  } catch (e) {
    next(e);
  }
});
