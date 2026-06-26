import { Router } from "express";
import mongoose from "mongoose";
import { Brand } from "../models/Brand.js";
import { getBrandModel } from "../models/brandSchema.js";
import { Tenant } from "../models/Tenant.js";
import { getTenantConnection } from "../db.js";
import { requireAdminAuth } from "../middleware/adminAuth.js";
import { serializeDocument, serializeLean } from "../util/serialize.js";

export const brandsRouter = Router();

async function resolveBrandModel(tenantId: string | null | undefined): Promise<{
  Model: typeof Brand | ReturnType<typeof getBrandModel>;
  useTenantFilter: boolean;
}> {
  if (tenantId) {
    const tenant = await Tenant.findById(tenantId).lean<{ databaseUri?: string }>();
    const uri = tenant?.databaseUri;
    if (uri && (uri.startsWith("mongodb://") || uri.startsWith("mongodb+srv://"))) {
      const conn = await getTenantConnection(uri);
      return { Model: getBrandModel(conn), useTenantFilter: false };
    }
  }
  return { Model: Brand, useTenantFilter: true };
}

// ── Public endpoint for storefront ────────────────────────────────────────────

brandsRouter.get("/public", async (req, res, next) => {
  try {
    const tenantId = req.query.tenantId as string | undefined;
    if (!tenantId) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "tenantId required" } });
      return;
    }
    const { Model, useTenantFilter } = await resolveBrandModel(tenantId);
    const filter = useTenantFilter ? { tenantId, status: "active" } : { status: "active" };
    const list = await Model.find(filter).sort({ name: 1 }).lean();
    res.json({ data: list.map((t) => serializeLean(t as Record<string, unknown>)) });
  } catch (e) {
    next(e);
  }
});

// ── Admin CRUD endpoints ───────────────────────────────────────────────────────

brandsRouter.use(requireAdminAuth);

brandsRouter.get("/", async (req, res, next) => {
  try {
    const a = req.admin!;
    const targetTenantId = a.role === "superadmin"
      ? (req.query.tenantId as string | undefined)
      : a.tenantId ?? undefined;

    const { Model, useTenantFilter } = await resolveBrandModel(targetTenantId);
    const filter: Record<string, unknown> = {};
    if (useTenantFilter && targetTenantId) {
      filter.tenantId = new mongoose.Types.ObjectId(targetTenantId);
    }

    const list = await Model.find(filter).sort({ name: 1 }).lean();
    res.json({ data: list.map((t) => serializeLean(t as Record<string, unknown>)) });
  } catch (e) {
    next(e);
  }
});

brandsRouter.post("/", async (req, res, next) => {
  try {
    const a = req.admin!;
    const body = { ...req.body };

    if (a.role !== "superadmin") {
      body.tenantId = a.tenantId;
    }

    const { Model, useTenantFilter } = await resolveBrandModel(body.tenantId);
    if (!useTenantFilter) delete body.tenantId;

    const doc = await Model.create(body);
    res.status(201).json({ data: serializeDocument(doc) });
  } catch (e) {
    next(e);
  }
});

brandsRouter.patch("/:id", async (req, res, next) => {
  try {
    const a = req.admin!;
    const tenantId = a.role !== "superadmin" ? a.tenantId : undefined;

    const { Model, useTenantFilter } = await resolveBrandModel(tenantId);
    const filter: Record<string, unknown> = { _id: req.params.id };
    if (useTenantFilter && tenantId) filter.tenantId = tenantId;

    const doc = await Model.findOneAndUpdate(filter, req.body, { new: true });
    if (!doc) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Brand not found" } });
      return;
    }
    res.json({ data: serializeDocument(doc) });
  } catch (e) {
    next(e);
  }
});

brandsRouter.delete("/:id", async (req, res, next) => {
  try {
    const a = req.admin!;
    const tenantId = a.role !== "superadmin" ? a.tenantId : undefined;

    const { Model, useTenantFilter } = await resolveBrandModel(tenantId);
    const filter: Record<string, unknown> = { _id: req.params.id };
    if (useTenantFilter && tenantId) filter.tenantId = tenantId;

    const doc = await Model.findOneAndDelete(filter);
    if (!doc) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Brand not found" } });
      return;
    }
    res.status(204).send();
  } catch (e) {
    next(e);
  }
});
