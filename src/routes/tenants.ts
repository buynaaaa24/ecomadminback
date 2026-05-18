import { Router } from "express";
import { Tenant } from "../models/Tenant.js";
import { requireAdminAuth, requireRole } from "../middleware/adminAuth.js";
import { serializeDocument, serializeLean } from "../util/serialize.js";

export const tenantsRouter = Router();

tenantsRouter.use(requireAdminAuth);
tenantsRouter.use(requireRole("superadmin")); // Only superadmin can manage tenants

tenantsRouter.get("/", async (req, res, next) => {
  try {
    const list = await Tenant.find().sort({ createdAt: -1 }).lean();
    res.json({ data: list.map((t) => serializeLean(t as Record<string, unknown>)) });
  } catch (e) {
    next(e);
  }
});

tenantsRouter.post("/", async (req, res, next) => {
  try {
    const doc = await Tenant.create(req.body);
    res.status(201).json({ data: serializeDocument(doc) });
  } catch (e) {
    next(e);
  }
});

tenantsRouter.patch("/:id", async (req, res, next) => {
  try {
    const doc = await Tenant.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!doc) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Tenant not found" } });
      return;
    }
    res.json({ data: serializeDocument(doc) });
  } catch (e) {
    next(e);
  }
});

tenantsRouter.delete("/:id", async (req, res, next) => {
  try {
    const doc = await Tenant.findByIdAndDelete(req.params.id);
    if (!doc) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Tenant not found" } });
      return;
    }
    res.status(204).send();
  } catch (e) {
    next(e);
  }
});
