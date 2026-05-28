import { Router } from "express";
import mongoose from "mongoose";
import { Product } from "../models/Product.js";
import { getProductModel } from "../models/productSchema.js";
import { Tenant } from "../models/Tenant.js";
import { getTenantConnection } from "../db.js";
import { requireAdminAuth } from "../middleware/adminAuth.js";
import { serializeDocument, serializeLean } from "../util/serialize.js";

/**
 * Enriches product lists with real-time POS stock (uldegdel) levels if POS integration is active.
 * Queries items in bulk using a single database call, falling back smoothly to cached local stock.
 */
async function syncPosProductsStock(products: any[], tenantId: string | null | undefined): Promise<any[]> {
  if (!tenantId || !products || products.length === 0) return products;

  try {
    const tenant = await Tenant.findById(tenantId).lean<{ posDbUri?: string; posBranchId?: string; posOrgId?: string }>();
    const posUri = tenant?.posDbUri;
    if (!posUri || (!posUri.startsWith("mongodb://") && !posUri.startsWith("mongodb+srv://"))) {
      return products;
    }

    const linkedProducts = products.filter((p) => p.isPosLinked && p.posProductCode);
    if (linkedProducts.length === 0) return products;

    const posConn = await getTenantConnection(posUri);
    const posModel = posConn.models.aguulakh || posConn.model("aguulakh", new mongoose.Schema({
      code: { type: String, required: true },
      uldegdel: { type: Number, default: 0 },
      salbariinId: String,
      baiguullagiinId: String,
    }, { collection: "aguulakh" }));

    const posCodes = linkedProducts.map((p) => p.posProductCode);
    const posFilter: Record<string, any> = { code: { $in: posCodes } };
    if (tenant.posBranchId) posFilter.salbariinId = tenant.posBranchId;
    if (tenant.posOrgId) posFilter.baiguullagiinId = tenant.posOrgId;

    const posItems = await posModel.find(posFilter).lean<{ code: string; uldegdel: number }[]>();

    const stockMap = new Map<string, number>();
    for (const item of posItems) {
      if (item && item.code) {
        stockMap.set(item.code, item.uldegdel ?? 0);
      }
    }

    return products.map((p) => {
      if (p.isPosLinked && p.posProductCode) {
        const liveStock = stockMap.get(p.posProductCode) ?? 0;
        return { ...p, stock: liveStock };
      }
      return p;
    });
  } catch (err) {
    console.error("[POS-SYNC] Failed to bulk sync POS stock counts:", err);
    return products;
  }
}

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
    
    const syncedList = await syncPosProductsStock(list, tenantId);
    res.json({ data: syncedList.map((t) => serializeLean(t as Record<string, unknown>)) });
  } catch (e) {
    next(e);
  }
});

// ── Admin endpoints ───────────────────────────────────────────────────────────

productsRouter.use(requireAdminAuth);

// ── POS Catalog Integration Endpoints ──────────────────────────────────────────
productsRouter.get("/pos-available", async (req, res, next) => {
  try {
    const a = req.admin!;
    const targetTenantId = a.role === "superadmin"
      ? (req.query.tenantId as string | undefined)
      : a.tenantId ?? undefined;

    if (!targetTenantId) {
      res.status(400).json({ error: "tenantId required" });
      return;
    }

    const tenant = await Tenant.findById(targetTenantId).lean<{ posDbUri?: string; posBranchId?: string; posOrgId?: string }>();
    const posUri = tenant?.posDbUri;
    if (!posUri || (!posUri.startsWith("mongodb://") && !posUri.startsWith("mongodb+srv://"))) {
      res.status(400).json({ error: "POS database integration is not configured or unconfigured." });
      return;
    }

    const posConn = await getTenantConnection(posUri);
    const posModel = posConn.models.aguulakh || posConn.model("aguulakh", new mongoose.Schema({
      code: String,
      barCode: String,
      ner: String,
      uldegdel: Number,
      niitUne: Number,
      urtugUne: Number,
      idevkhteiEsekh: Boolean,
      salbariinId: String,
      baiguullagiinId: String,
    }, { collection: "aguulakh" }));

    const posFilter: Record<string, any> = { idevkhteiEsekh: { $ne: false } };
    if (tenant.posBranchId) posFilter.salbariinId = tenant.posBranchId;
    if (tenant.posOrgId) posFilter.baiguullagiinId = tenant.posOrgId;

    const posItems = await posModel.find(posFilter).sort({ ner: 1 }).lean();

    const { Model } = await resolveProductModel(targetTenantId);
    const alreadyImportedDocs = await Model.find({ isPosLinked: true }).lean<{ posProductCode?: string }[]>();
    const importedCodes = new Set(alreadyImportedDocs.map((x) => x.posProductCode));

    const mapped = posItems.map((item: any) => ({
      code: item.code,
      barcode: item.barCode ?? "",
      name: item.ner,
      stock: item.uldegdel ?? 0,
      price: item.niitUne ?? item.urtugUne ?? 0,
      alreadyImported: importedCodes.has(item.code),
    }));

    res.json({ data: mapped });
  } catch (e) {
    next(e);
  }
});

productsRouter.post("/pos-import", async (req, res, next) => {
  try {
    const a = req.admin!;
    const { codes } = req.body;
    const targetTenantId = a.role === "superadmin"
      ? (req.body.tenantId as string | undefined)
      : a.tenantId ?? undefined;

    if (!targetTenantId) {
      res.status(400).json({ error: "tenantId required" });
      return;
    }
    if (!codes || !Array.isArray(codes) || codes.length === 0) {
      res.status(400).json({ error: "codes array required" });
      return;
    }

    const tenant = await Tenant.findById(targetTenantId).lean<{ posDbUri?: string; posBranchId?: string; posOrgId?: string }>();
    const posUri = tenant?.posDbUri;
    if (!posUri || (!posUri.startsWith("mongodb://") && !posUri.startsWith("mongodb+srv://"))) {
      res.status(400).json({ error: "POS database integration is not configured or unconfigured." });
      return;
    }

    const posConn = await getTenantConnection(posUri);
    const posModel = posConn.models.aguulakh || posConn.model("aguulakh", new mongoose.Schema({
      code: String,
      barCode: String,
      ner: String,
      uldegdel: Number,
      niitUne: Number,
      urtugUne: Number,
      salbariinId: String,
      baiguullagiinId: String,
    }, { collection: "aguulakh" }));

    const posFilter: Record<string, any> = { code: { $in: codes } };
    if (tenant.posBranchId) posFilter.salbariinId = tenant.posBranchId;
    if (tenant.posOrgId) posFilter.baiguullagiinId = tenant.posOrgId;

    const posItems = await posModel.find(posFilter).lean();
    if (posItems.length === 0) {
      res.status(400).json({ error: "No matching POS items found for import." });
      return;
    }

    const { Model, useTenantFilter } = await resolveProductModel(targetTenantId);
    const importedResults = [];

    const slugify = (text: string) => {
      return text
        .toString()
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^\w\-]+/g, "")
        .replace(/\-\-+/g, "-")
        .replace(/^-+/, "")
        .replace(/-+$/, "");
    };

    for (const item of posItems as any[]) {
      const price = item.niitUne || item.urtugUne || 0;
      const cleanSlug = `${slugify(item.ner || "imported")}-${item.code}`;

      const mappedBody: Record<string, any> = {
        name: item.ner,
        price: price,
        stock: item.uldegdel ?? 0,
        isPosLinked: true,
        posProductCode: item.code,
        slug: cleanSlug,
        status: "active",
      };

      if (useTenantFilter) {
        mappedBody.tenantId = new mongoose.Types.ObjectId(targetTenantId);
      }

      const doc = await Model.findOneAndUpdate(
        { posProductCode: item.code },
        mappedBody,
        { upsert: true, new: true }
      );
      importedResults.push(doc);
    }

    res.status(201).json({ data: importedResults.map((doc) => serializeDocument(doc)) });
  } catch (e) {
    next(e);
  }
});

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
    const syncedList = await syncPosProductsStock(list, targetTenantId);
    res.json({ data: syncedList.map((t) => serializeLean(t as Record<string, unknown>)) });
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
