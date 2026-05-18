import { Router } from "express";
import { Tenant } from "../models/Tenant.js";
import { serializeLean } from "../util/serialize.js";

export const configRouter = Router();

configRouter.get("/", async (req, res, next) => {
  try {
    // Prefer the explicit header, fall back to Host header
    const raw = (req.headers["x-tenant-host"] ?? req.headers.host ?? "") as string;
    const host = raw.split(":")[0].toLowerCase().trim();

    let tenant = null;

    if (host && host !== "localhost" && host !== "127.0.0.1") {
      // 1. Match by exact custom domain
      tenant = await Tenant.findOne({ domain: host, status: "active" }).lean();

      // 2. Fall back: match by slug (allows <slug>.yourdomain.com style)
      if (!tenant) {
        const subSlug = host.split(".")[0];
        tenant = await Tenant.findOne({ slug: subSlug, status: "active" }).lean();
      }
    } else {
      // Local dev: return the first active tenant
      tenant = await Tenant.findOne({ status: "active" }).lean();
    }

    if (!tenant) {
      res.status(404).json({
        error: { code: "NOT_FOUND", message: "No matching active tenant found" },
      });
      return;
    }

    const t = tenant as Record<string, unknown>;

    res.json({
      tenantId: t._id,
      branding: {
        name: t.name,
        logo: t.logo,
        primaryColor: t.primaryColor,
        secondaryColor: t.secondaryColor,
        accentColor: t.accentColor,
        font: t.font,
        description: t.description,
      },
      theme: {
        layout: t.layout,
        homepageSections: [
          { type: "HeroBanner", props: { title: t.bannerTitle, subtitle: t.bannerSubtitle } },
          { type: "CategoryList", props: {} },
          { type: "ProductGrid", props: { title: "Шинэ бараа", isNew: true, limit: 8 } },
          { type: "ProductGrid", props: { title: "Хямдралтай", isSale: true, limit: 8 } },
          { type: "GroceryBento", props: {} },
          { type: "BrandList", props: {} },
        ],
      },
      contact: {
        email: t.contactEmail,
        phone: t.contactPhone,
        address: t.address,
      },
      features: t.features,
    });
  } catch (e) {
    next(e);
  }
});
