import { Router } from "express";
import jwt from "jsonwebtoken";
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

    // Optional auth check for admins loading their specific tenant config
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
        } catch (e) {
          // ignore error, fall back to normal resolution
        }
      }
    }

    if (!tenant && querySlug) {
      tenant = await Tenant.findOne({ slug: querySlug.toLowerCase().trim(), status: "active" }).lean();
      if (!tenant) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: "No matching active tenant found" },
        });
        return;
      }
    } else if (!tenant) {
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
      slug: t.slug,
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
      promo: {
        visible: t.promoVisible ?? true,
        label: t.promoLabel ?? "Хязгаартай",
        discount: t.promoDiscount ?? "30% OFF",
        subtitle: t.promoSubtitle ?? "",
        href: t.promoHref ?? "/",
      },
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
      promoVisible,
      promoLabel,
      promoDiscount,
      promoSubtitle,
      promoHref,
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
    if (promoVisible !== undefined) tenant.promoVisible = promoVisible;
    if (promoLabel !== undefined) tenant.promoLabel = promoLabel;
    if (promoDiscount !== undefined) tenant.promoDiscount = promoDiscount;
    if (promoSubtitle !== undefined) tenant.promoSubtitle = promoSubtitle;
    if (promoHref !== undefined) tenant.promoHref = promoHref;

    await tenant.save();

    res.json({ success: true, message: "Settings updated" });
  } catch (e) {
    next(e);
  }
});
