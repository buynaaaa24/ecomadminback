import { Router } from "express";
import jwt from "jsonwebtoken";
import { getProductModel } from "../models/productSchema.js";
import { Tenant } from "../models/Tenant.js";
import { getTenantConnection } from "../db.js";

export const brandsRouter = Router();

/**
 * GET /api/brands
 * Returns unique brands derived from products for the active tenant.
 * Public endpoint — no auth required.
 */
brandsRouter.get("/", async (req, res, next) => {
  try {
    const raw = (req.headers["x-tenant-host"] ?? req.headers.host ?? "") as string;
    const host = raw.split(":")[0].toLowerCase().trim();
    const querySlug = req.query.tenant as string | undefined;

    let tenant: any = null;

    // Optional: honour Bearer token tenant lookup
    const rawAuth = req.headers.authorization;
    if (rawAuth) {
      const m = rawAuth.match(/^Bearer\s+(.+)$/i);
      if (m && m[1]) {
        try {
          const secret = process.env.ADMIN_JWT_SECRET ?? "";
          const payload = jwt.verify(m[1], secret) as jwt.JwtPayload;
          if (payload.tenantId) {
            tenant = await Tenant.findById(payload.tenantId).lean();
          }
        } catch { /* ignore */ }
      }
    }

    if (!tenant && querySlug) {
      tenant = await Tenant.findOne({ slug: querySlug.toLowerCase().trim(), status: "active" }).lean();
    }

    if (!tenant) {
      const isIp = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
      if (host && host !== "localhost" && host !== "127.0.0.1" && !isIp) {
        tenant = await Tenant.findOne({ domain: host, status: "active" }).lean();
        if (!tenant) {
          const subSlug = host.split(".")[0];
          tenant = await Tenant.findOne({ slug: subSlug, status: "active" }).lean();
        }
      } else {
        tenant = await Tenant.findOne({ status: "active" }).lean();
      }
    }

    if (!tenant) {
      res.json([]);
      return;
    }

    const tenantId = String((tenant as any)._id);
    let ProductModel: any;

    if ((tenant as any).databaseUri) {
      const conn = await getTenantConnection((tenant as any).databaseUri);
      ProductModel = getProductModel(conn);
    } else {
      const { Product } = await import("../models/Product.js");
      ProductModel = Product;
    }

    // Distinct brandIds that are non-empty strings
    const rawBrands: string[] = await ProductModel.distinct("brandId", {
      tenantId,
      status: "active",
      brandId: { $exists: true, $ne: "" },
    });

    const brands = rawBrands
      .filter((b) => b && b.trim())
      .sort((a, b) => a.localeCompare(b, "mn"))
      .map((name) => ({
        id: name,
        name,
        slug: name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""),
      }));

    res.json(brands);
  } catch (e) {
    next(e);
  }
});
