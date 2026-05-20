import { Router } from "express";
import mongoose from "mongoose";
import { Product } from "../models/Product.js";
import { getProductModel } from "../models/productSchema.js";
import { Tenant } from "../models/Tenant.js";
import { getTenantConnection } from "../db.js";
import { requireAdminAuth } from "../middleware/adminAuth.js";
import { serializeDocument, serializeLean } from "../util/serialize.js";

export const productsRouter = Router();

/**
 * Resolve the Product model to use for a given tenantId.
 * If the tenant has a dedicated databaseUri, use a per-connection model.
 * Otherwise fall back to the shared central model (with tenantId filter).
 */
async function resolveProductModel(tenantId: string | null | undefined): Promise<{
  Model: typeof Product | ReturnType<typeof getProductModel>;
  useTenantFilter: boolean;
}> {
  if (tenantId) {
    const tenant = await Tenant.findById(tenantId).lean<{ databaseUri?: string }>();
    const uri = tenant?.databaseUri;
    if (uri && (uri.startsWith("mongodb://") || uri.startsWith("mongodb+srv://"))) {
      const conn = await getTenantConnection(uri);
      return { Model: getProductModel(conn), useTenantFilter: false };
    }
  }
  return { Model: Product, useTenantFilter: true };
}

// ── Public endpoint for storefront ────────────────────────────────────────────

productsRouter.get("/public", async (req, res, next) => {
  try {
    const tenantId = req.query.tenantId as string | undefined;
    if (!tenantId) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "tenantId required" } });
      return;
    }

    const { Model, useTenantFilter } = await resolveProductModel(tenantId);
    const statusFilter = { status: { $nin: ["inactive", "draft"] } };
    const filter = useTenantFilter ? { tenantId, ...statusFilter } : statusFilter;
    const list = await Model.find(filter).sort({ createdAt: -1 }).lean();
    res.json({ data: list.map((t) => serializeLean(t as Record<string, unknown>)) });
  } catch (e) {
    next(e);
  }
});

// ── Admin endpoints ───────────────────────────────────────────────────────────

productsRouter.use(requireAdminAuth);

productsRouter.get("/", async (req, res, next) => {
  try {
    const a = req.admin!;
    const targetTenantId = a.role === "superadmin"
      ? (req.query.tenantId as string | undefined)
      : a.tenantId ?? undefined;

    const { Model, useTenantFilter } = await resolveProductModel(targetTenantId);
    const filter: Record<string, unknown> = {};
    if (useTenantFilter && targetTenantId) {
      filter.tenantId = new mongoose.Types.ObjectId(targetTenantId);
    }

    const list = await Model.find(filter).sort({ createdAt: -1 }).lean();
    res.json({ data: list.map((t) => serializeLean(t as Record<string, unknown>)) });
  } catch (e) {
    next(e);
  }
});

productsRouter.post("/", async (req, res, next) => {
  try {
    const a = req.admin!;
    const body = { ...req.body };

    // Regular admins are scoped to their tenant
    if (a.role !== "superadmin") {
      body.tenantId = a.tenantId;
    }

    const { Model, useTenantFilter } = await resolveProductModel(body.tenantId);
    // In a dedicated tenant DB, tenantId is redundant — strip it to keep docs clean
    if (!useTenantFilter) delete body.tenantId;

    const doc = await Model.create(body);
    res.status(201).json({ data: serializeDocument(doc) });
  } catch (e) {
    next(e);
  }
});

productsRouter.patch("/:id", async (req, res, next) => {
  try {
    const a = req.admin!;
    const tenantId = a.role !== "superadmin" ? a.tenantId : undefined;

    const { Model, useTenantFilter } = await resolveProductModel(tenantId);
    const filter: Record<string, unknown> = { _id: req.params.id };
    if (useTenantFilter && tenantId) filter.tenantId = tenantId;

    const doc = await Model.findOneAndUpdate(filter, req.body, { new: true });
    if (!doc) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Product not found" } });
      return;
    }
    res.json({ data: serializeDocument(doc) });
  } catch (e) {
    next(e);
  }
});

productsRouter.delete("/:id", async (req, res, next) => {
  try {
    const a = req.admin!;
    const tenantId = a.role !== "superadmin" ? a.tenantId : undefined;

    const { Model, useTenantFilter } = await resolveProductModel(tenantId);
    const filter: Record<string, unknown> = { _id: req.params.id };
    if (useTenantFilter && tenantId) filter.tenantId = tenantId;

    const doc = await Model.findOneAndDelete(filter);
    if (!doc) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Product not found" } });
      return;
    }
    res.status(204).send();
  } catch (e) {
    next(e);
  }
});
