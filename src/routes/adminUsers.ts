import { Router } from "express";
import bcrypt from "bcryptjs";
import { AdminUser } from "../models/AdminUser.js";
import { requireAdminAuth, requireRole } from "../middleware/adminAuth.js";
import { serializeDocument, serializeLean } from "../util/serialize.js";

export const adminUsersRouter = Router();

adminUsersRouter.use(requireAdminAuth);
adminUsersRouter.use(requireRole("superadmin")); // Only superadmin can manage admins

adminUsersRouter.get("/", async (req, res, next) => {
  try {
    const list = await AdminUser.find().select("-passwordHash").sort({ createdAt: -1 }).lean();
    res.json({ data: list.map((t) => serializeLean(t as Record<string, unknown>)) });
  } catch (e) {
    next(e);
  }
});

adminUsersRouter.post("/", async (req, res, next) => {
  try {
    const { password, ...rest } = req.body;
    if (!password) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Password is required" } });
      return;
    }
    
    const passwordHash = await bcrypt.hash(password, 10);
    const doc = await AdminUser.create({ ...rest, passwordHash });
    
    const safeDoc = await AdminUser.findById(doc._id).select("-passwordHash").lean();
    res.status(201).json({ data: serializeLean(safeDoc as Record<string, unknown>) });
  } catch (e) {
    next(e);
  }
});

adminUsersRouter.patch("/:id", async (req, res, next) => {
  try {
    const { password, ...rest } = req.body;
    const update = { ...rest };
    
    if (password) {
      update.passwordHash = await bcrypt.hash(password, 10);
    }
    
    const doc = await AdminUser.findByIdAndUpdate(req.params.id, update, { new: true }).select("-passwordHash").lean();
    if (!doc) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "User not found" } });
      return;
    }
    res.json({ data: serializeLean(doc as Record<string, unknown>) });
  } catch (e) {
    next(e);
  }
});

adminUsersRouter.delete("/:id", async (req, res, next) => {
  try {
    const doc = await AdminUser.findByIdAndDelete(req.params.id);
    if (!doc) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "User not found" } });
      return;
    }
    res.status(204).send();
  } catch (e) {
    next(e);
  }
});
