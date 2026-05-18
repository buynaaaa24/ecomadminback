import { Router } from "express";
import { Product } from "../models/Product.js";
import { requireAdminAuth } from "../middleware/adminAuth.js";
import { serializeDocument, serializeLean } from "../util/serialize.js";

export const productsRouter = Router();

// Public endpoint for storefront
productsRouter.get("/public", async (req, res, next) => {
  try {
    const tenantId = req.query.tenantId;
    if (!tenantId) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "tenantId required" } });
      return;
    }
    const list = await Product.find({ tenantId }).sort({ createdAt: -1 }).lean();
    res.json({ data: list.map((t) => serializeLean(t as Record<string, unknown>)) });
  } catch (e) {
    next(e);
  }
});

// Admin endpoints
productsRouter.use(requireAdminAuth);

productsRouter.get("/", async (req, res, next) => {
  try {
    const a = req.admin!;
    // Superadmin sees all, or can filter by tenantId. Admin sees only their tenant.
    const filter: Record<string, any> = {};
    if (a.role !== "superadmin") {
      filter.tenantId = a.tenantId;
    } else if (req.query.tenantId) {
      filter.tenantId = req.query.tenantId;
    }
    
    const list = await Product.find(filter).sort({ createdAt: -1 }).lean();
    res.json({ data: list.map((t) => serializeLean(t as Record<string, unknown>)) });
  } catch (e) {
    next(e);
  }
});

productsRouter.post("/", async (req, res, next) => {
  try {
    const a = req.admin!;
    const body = { ...req.body };
    
    // Force tenantId for market admins
    if (a.role !== "superadmin") {
      body.tenantId = a.tenantId;
    }
    
    const doc = await Product.create(body);
    res.status(201).json({ data: serializeDocument(doc) });
  } catch (e) {
    next(e);
  }
});

productsRouter.patch("/:id", async (req, res, next) => {
  try {
    const a = req.admin!;
    const filter: Record<string, any> = { _id: req.params.id };
    if (a.role !== "superadmin") {
      filter.tenantId = a.tenantId;
    }
    
    const doc = await Product.findOneAndUpdate(filter, req.body, { new: true });
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
    const filter: Record<string, any> = { _id: req.params.id };
    if (a.role !== "superadmin") {
      filter.tenantId = a.tenantId;
    }
    
    const doc = await Product.findOneAndDelete(filter);
    if (!doc) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Product not found" } });
      return;
    }
    res.status(204).send();
  } catch (e) {
    next(e);
  }
});
