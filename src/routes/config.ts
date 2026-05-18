import { Router } from "express";
import { Tenant } from "../models/Tenant.js";
import { serializeLean } from "../util/serialize.js";

export const configRouter = Router();

configRouter.get("/", async (req, res, next) => {
  try {
    const host = req.headers["x-tenant-host"] || req.headers.host;
    let tenant = null;

    if (host) {
      // Very basic host matching logic (in production, match custom domains)
      // For localhost demo, we might fall back to first tenant
      const domain = String(host).split(":")[0];
      
      // If we have a custom logic to map host -> tenant slug:
      // For now, let's just find the first active tenant if it's localhost
      if (domain === "localhost" || domain === "127.0.0.1") {
        tenant = await Tenant.findOne({ status: "active" }).lean();
      } else {
        tenant = await Tenant.findOne({ slug: domain, status: "active" }).lean();
      }
    }

    if (!tenant) {
      // Fallback
      tenant = await Tenant.findOne({ status: "active" }).lean();
    }

    if (!tenant) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "No active tenant found" } });
      return;
    }

    const t = tenant as any;
    
    // Return format expected by ikhNaydEcomm fetchTenantConfig()
    res.json({
      tenantId: t._id,
      branding: {
        logo: t.logo,
        primaryColor: t.primaryColor,
        font: t.font,
      },
      theme: {
        layout: t.layout,
        homepageSections: [
          { type: 'HeroBanner', props: {} },
          { type: 'CategoryList', props: {} },
          { type: 'ProductGrid', props: { title: 'Шинэ бараа', isNew: true, limit: 8 } },
          { type: 'ProductGrid', props: { title: 'Хямдралтай', isSale: true, limit: 8 } },
          { type: 'GroceryBento', props: {} },
          { type: 'BrandList', props: {} },
        ]
      },
      features: t.features,
    });
  } catch (e) {
    next(e);
  }
});
