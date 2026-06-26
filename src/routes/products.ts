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
    if (!posUri || (!posUri.startsWith("http://") && !posUri.startsWith("https://"))) {
      return products;
    }

    const linkedProducts = products.filter((p) => p.isPosLinked && p.posProductCode);
    if (linkedProducts.length === 0) return products;

    const posCodes = linkedProducts.map((p) => p.posProductCode);
    let posItems: { code: string; uldegdel: number }[] = [];

    const response = await fetch(`${posUri.replace(/\/$/, "")}/api/ecom/pos-stock-sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        codes: posCodes,
        salbariinId: tenant.posBranchId,
        baiguullagiinId: tenant.posOrgId,
      }),
    });

    if (!response.ok) {
      throw new Error(`POS API stock sync failed with status ${response.status}`);
    }

    const resBody = await response.json() as { data?: { code: string; uldegdel: number }[] };
    posItems = resBody.data || [];

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

/**
 * Enriches product lists with real-time EM stock (uldegdel) levels if EM integration is active.
 */
async function syncEmProductsStock(products: any[], tenantId: string | null | undefined): Promise<any[]> {
  if (!tenantId || !products || products.length === 0) return products;

  try {
    const tenant = await Tenant.findById(tenantId).lean<{ emDbUri?: string; emOrgId?: string; emBranchId?: string }>();
    const emUri = tenant?.emDbUri;
    if (!emUri || (!emUri.startsWith("http://") && !emUri.startsWith("https://"))) {
      return products;
    }
    const emOrgId = tenant?.emOrgId ?? "";
    const emBranchId = tenant?.emBranchId ?? "";

    const linkedProducts = products.filter((p) => p.isEmLinked && p.emProductCode);
    if (linkedProducts.length === 0) return products;

    const emCodes = linkedProducts.map((p) => p.emProductCode);
    let emItems: { code: string; uldegdel: number }[] = [];

    const response = await fetch(`${emUri.replace(/\/$/, "")}/api/ecom/em-stock-sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        codes: emCodes,
        ...(emBranchId ? { salbariinId: emBranchId } : {}),
        ...(emOrgId ? { baiguullagiinId: emOrgId } : {}),
      }),
    });

    if (!response.ok) {
      throw new Error(`EM API stock sync failed with status ${response.status}`);
    }

    const resBody = await response.json() as { data?: { code: string; uldegdel: number }[] };
    emItems = resBody.data || [];

    const stockMap = new Map<string, number>();
    for (const item of emItems) {
      if (item && item.code) {
        stockMap.set(item.code, item.uldegdel ?? 0);
      }
    }

    return products.map((p) => {
      if (p.isEmLinked && p.emProductCode) {
        const liveStock = stockMap.get(p.emProductCode) ?? 0;
        return { ...p, stock: liveStock };
      }
      return p;
    });
  } catch (err) {
    console.error("[EM-SYNC] Failed to bulk sync EM stock counts:", err);
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
    const syncedListWithEm = await syncEmProductsStock(syncedList, tenantId);
    res.json({ data: syncedListWithEm.map((t) => serializeLean(t as Record<string, unknown>)) });
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
    if (!posUri || (!posUri.startsWith("http://") && !posUri.startsWith("https://"))) {
      res.status(400).json({ error: "POS database integration is not configured or unconfigured." });
      return;
    }

    const salbariinId = tenant.posBranchId ?? "";
    const baiguullagiinId = tenant.posOrgId ?? "";
    const qs = `salbariinId=${encodeURIComponent(salbariinId)}&baiguullagiinId=${encodeURIComponent(baiguullagiinId)}`;
    
    const response = await fetch(`${posUri.replace(/\/$/, "")}/api/ecom/pos-available?${qs}`);
    if (!response.ok) {
      throw new Error(`POS API returned status ${response.status}`);
    }
    const resBody = await response.json() as { data?: any[] };
    const rawItems = resBody.data || [];
    const posItems = rawItems.map((item) => ({
      code: item.code,
      ner: item.ner ?? item.name,
      barCode: item.barcode ?? item.barCode,
      uldegdel: item.stock ?? item.uldegdel,
      niitUne: item.price ?? item.niitUne,
      image: item.image ?? "",
    }));

    const { Model } = await resolveProductModel(targetTenantId);
    const alreadyImportedDocs = await Model.find({ isPosLinked: true }).lean<{ posProductCode?: string }[]>();
    const importedCodes = new Set(alreadyImportedDocs.map((x) => x.posProductCode));

    const mapped = posItems.map((item: any) => ({
      code: item.code,
      barcode: item.barCode ?? "",
      name: item.ner,
      stock: item.uldegdel ?? 0,
      price: item.niitUne ?? item.urtugUne ?? 0,
      image: item.image ? `${posUri.replace(/\/$/, "")}${item.image}` : "",
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
    if (!posUri || (!posUri.startsWith("http://") && !posUri.startsWith("https://"))) {
      res.status(400).json({ error: "POS database integration is not configured or unconfigured." });
      return;
    }

    const salbariinId = tenant.posBranchId ?? "";
    const baiguullagiinId = tenant.posOrgId ?? "";
    const qs = `salbariinId=${encodeURIComponent(salbariinId)}&baiguullagiinId=${encodeURIComponent(baiguullagiinId)}`;
    
    const response = await fetch(`${posUri.replace(/\/$/, "")}/api/ecom/pos-available?${qs}`);
    if (!response.ok) {
      throw new Error(`POS API returned status ${response.status}`);
    }
    const resBody = await response.json() as { data?: any[] };
    const allPosItems = resBody.data || [];
    const codesSet = new Set(codes);
    const posItems = allPosItems
      .filter((item: any) => codesSet.has(item.code))
      .map((item: any) => ({
        code: item.code,
        ner: item.ner ?? item.name,
        barCode: item.barcode ?? item.barCode,
        uldegdel: item.stock ?? item.uldegdel,
        niitUne: item.price ?? item.niitUne,
        image: item.image ?? "",
      }));

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
      const imageUrl = item.image ? `${posUri.replace(/\/$/, "")}${item.image}` : "";

      const mappedBody: Record<string, any> = {
        name: item.ner,
        price: price,
        stock: item.uldegdel ?? 0,
        isPosLinked: true,
        posProductCode: item.code,
        slug: cleanSlug,
        status: "active",
      };

      if (imageUrl) {
        mappedBody.images = [imageUrl];
      }

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

// ── EM Catalog Integration Endpoints ──────────────────────────────────────────
productsRouter.get("/em-available", async (req, res, next) => {
  try {
    const a = req.admin!;
    const targetTenantId = a.role === "superadmin"
      ? (req.query.tenantId as string | undefined)
      : a.tenantId ?? undefined;

    if (!targetTenantId) {
      res.status(400).json({ error: "tenantId required" });
      return;
    }

    const tenant = await Tenant.findById(targetTenantId).lean<{ emDbUri?: string; emOrgId?: string; emBranchId?: string }>();
    const emUri = tenant?.emDbUri;
    if (!emUri || (!emUri.startsWith("http://") && !emUri.startsWith("https://"))) {
      res.status(400).json({ error: "EM database integration is not configured." });
      return;
    }
    const emAvailQs = new URLSearchParams();
    if (tenant?.emBranchId) emAvailQs.set("salbariinId", tenant.emBranchId);
    if (tenant?.emOrgId) emAvailQs.set("baiguullagiinId", tenant.emOrgId);
    const emAvailQsStr = emAvailQs.toString() ? `?${emAvailQs.toString()}` : "";

    const response = await fetch(`${emUri.replace(/\/$/, "")}/api/ecom/em-available${emAvailQsStr}`);
    if (!response.ok) {
      throw new Error(`EM API returned status ${response.status}`);
    }
    const resBody = await response.json() as { data?: any[] };
    const emItems = resBody.data || [];
    const mappedEmItems = emItems.map((item) => ({
      code: item.code,
      name: item.ner ?? item.name,
      barcode: item.barcode ?? item.barCode,
      stock: item.stock ?? item.uldegdel,
      price: item.price ?? item.niitUne,
      image: item.image ?? "",
    }));

    const { Model } = await resolveProductModel(targetTenantId);
    const alreadyImportedDocs = await Model.find({ isEmLinked: true }).lean<{ emProductCode?: string }[]>();
    const importedCodes = new Set(alreadyImportedDocs.map((x) => x.emProductCode));

    const mapped = mappedEmItems.map((item: any) => ({
      code: item.code,
      barcode: item.barcode ?? "",
      name: item.name,
      stock: item.stock ?? 0,
      price: item.price ?? 0,
      image: item.image ? `${emUri.replace(/\/$/, "")}${item.image}` : "",
      alreadyImported: importedCodes.has(item.code),
    }));

    res.json({ data: mapped });
  } catch (e) {
    next(e);
  }
});

productsRouter.post("/em-import", async (req, res, next) => {
  try {
    const a = req.admin!;
    const { codes, categoryOverrides } = req.body;
    const catOverrides: Record<string, string> = (categoryOverrides && typeof categoryOverrides === "object") ? categoryOverrides : {};
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

    const tenant2 = await Tenant.findById(targetTenantId).lean<{ emDbUri?: string; emOrgId?: string; emBranchId?: string }>();
    const emUri = tenant2?.emDbUri;
    if (!emUri || (!emUri.startsWith("http://") && !emUri.startsWith("https://"))) {
      res.status(400).json({ error: "EM database integration is not configured." });
      return;
    }
    const emImportOrgId = tenant2?.emOrgId ?? "";
    const emImportBranchId = tenant2?.emBranchId ?? "";
    const emImportQs = new URLSearchParams();
    if (emImportBranchId) emImportQs.set("salbariinId", emImportBranchId);
    if (emImportOrgId) emImportQs.set("baiguullagiinId", emImportOrgId);
    const emImportQsStr = emImportQs.toString() ? `?${emImportQs.toString()}` : "";

    const response = await fetch(`${emUri.replace(/\/$/, "")}/api/ecom/em-available${emImportQsStr}`);
    if (!response.ok) {
      throw new Error(`EM API returned status ${response.status}`);
    }
    const resBody = await response.json() as { data?: any[] };
    const allEmItems = resBody.data || [];
    const codesSet = new Set(codes);
    const emItems = allEmItems
      .filter((item: any) => codesSet.has(item.code))
      .map((item: any) => ({
        code: item.code,
        name: item.ner ?? item.name,
        barcode: item.barcode ?? item.barCode,
        stock: item.stock ?? item.uldegdel,
        price: item.price ?? item.niitUne,
        image: item.image ?? "",
      }));

    if (emItems.length === 0) {
      res.status(400).json({ error: "No matching EM items found for import." });
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

    for (const item of emItems as any[]) {
      const price = item.price || 0;
      const cleanSlug = `${slugify(item.name || "imported")}-${item.code}`;
      const imageUrl = item.image ? `${emUri.replace(/\/$/, "")}${item.image}` : "";

      const mappedBody: Record<string, any> = {
        name: item.name,
        price: price,
        stock: item.stock ?? 0,
        isEmLinked: true,
        emProductCode: item.code,
        slug: cleanSlug,
        status: "active",
      };

      if (catOverrides[item.code]) {
        mappedBody.categoryId = catOverrides[item.code];
      }

      if (imageUrl) {
        mappedBody.images = [imageUrl];
      }

      if (useTenantFilter) {
        mappedBody.tenantId = new mongoose.Types.ObjectId(targetTenantId);
      }

      const doc = await Model.findOneAndUpdate(
        { emProductCode: item.code },
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
    const syncedListWithEm = await syncEmProductsStock(syncedList, targetTenantId);
    res.json({ data: syncedListWithEm.map((t) => serializeLean(t as Record<string, unknown>)) });
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
