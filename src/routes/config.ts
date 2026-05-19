import { Router } from "express";
import { Tenant } from "../models/Tenant.js";
import { serializeLean } from "../util/serialize.js";
import { requireAdminAuth } from "../middleware/adminAuth.js";

export const configRouter = Router();

configRouter.get("/", async (req, res, next) => {
  try {
    // Prefer the explicit header, fall back to Host header
    const raw = (req.headers["x-tenant-host"] ?? req.headers.host ?? "") as string;
    const host = raw.split(":")[0].toLowerCase().trim();
    const querySlug = req.query.tenant as string | undefined;

    let tenant = null;

    if (querySlug) {
      tenant = await Tenant.findOne({ slug: querySlug.toLowerCase().trim(), status: "active" }).lean();
      if (!tenant) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: "No matching active tenant found" },
        });
        return;
      }
    } else {
      const isIp = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
      if (host && host !== "localhost" && host !== "127.0.0.1" && !isIp) {
        // 1. Match by exact custom domain
        tenant = await Tenant.findOne({ domain: host, status: "active" }).lean();

        // 2. Fall back: match by slug (allows <slug>.yourdomain.com style)
        if (!tenant) {
          const subSlug = host.split(".")[0];
          tenant = await Tenant.findOne({ slug: subSlug, status: "active" }).lean();
        }
      } else {
        tenant = await Tenant.findOne({ status: "active" }).lean();
      }
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

configRouter.patch("/", requireAdminAuth, async (req, res, next) => {
  try {
    const admin = req.admin;
    let tenant = null;

    if (admin && admin.tenantId) {
      tenant = await Tenant.findById(admin.tenantId);
    } else {
      // Fallback for superadmin without specific tenantId
      const raw = (req.headers["x-tenant-host"] ?? req.headers.host ?? "") as string;
      const host = raw.split(":")[0].toLowerCase().trim();
      const querySlug = req.query.tenant as string | undefined;

      if (querySlug) {
        tenant = await Tenant.findOne({ slug: querySlug.toLowerCase().trim(), status: "active" });
      } else {
        const isIp = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
        if (host && host !== "localhost" && host !== "127.0.0.1" && !isIp) {
          tenant = await Tenant.findOne({ domain: host, status: "active" });
          if (!tenant) {
            const subSlug = host.split(".")[0];
            tenant = await Tenant.findOne({ slug: subSlug, status: "active" });
          }
        } else {
          tenant = await Tenant.findOne({ status: "active" });
        }
      }
    }

    if (!tenant) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "No active tenant found" } });
      return;
    }

    const {
      storeName,
      logo,
      primaryColor,
      bannerTitle,
      bannerSubtitle,
      contactEmail,
      contactPhone,
      address,
      features,
    } = req.body;

    if (storeName !== undefined) tenant.name = storeName;
    if (logo !== undefined) tenant.logo = logo;
    if (primaryColor !== undefined) tenant.primaryColor = primaryColor;
    if (bannerTitle !== undefined) tenant.bannerTitle = bannerTitle;
    if (bannerSubtitle !== undefined) tenant.bannerSubtitle = bannerSubtitle;
    if (contactEmail !== undefined) tenant.contactEmail = contactEmail;
    if (contactPhone !== undefined) tenant.contactPhone = contactPhone;
    if (address !== undefined) tenant.address = address;
    if (features !== undefined) tenant.features = features;

    await tenant.save();

    res.json({ success: true, message: "Settings updated" });
  } catch (e) {
    next(e);
  }
});
