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
          {
            type: "HeroBanner",
            props: {
              title: t.bannerTitle,
              subtitle: t.bannerSubtitle,
              bigSlides: Array.isArray(t.bannerSlidesBig) ? t.bannerSlidesBig : [],
              smallSlides: Array.isArray(t.bannerSlidesSmall) ? t.bannerSlidesSmall : [],
            },
          },
          { type: "CategoryList", props: {} },
          { type: "CategoryProductSection", props: {} },
          { type: "GroceryBento", props: { tiles: Array.isArray(t.bentoTiles) ? t.bentoTiles : [], sectionTitle: t.bentoTitle ?? "" } },
          { type: "BrandList", props: {} },
        ],
      },
      bannerSlidesBig:   Array.isArray(t.bannerSlidesBig)   ? t.bannerSlidesBig   : [],
      bannerSlidesSmall: Array.isArray(t.bannerSlidesSmall) ? t.bannerSlidesSmall : [],
      bentoTiles:        Array.isArray(t.bentoTiles)        ? t.bentoTiles        : [],
      bentoTitle:        t.bentoTitle ?? "",
      contact: {
        email: t.contactEmail,
        phone: t.contactPhone,
        address: t.address,
      },
      features: t.features,
      locations: Array.isArray(t.locations) ? t.locations : [],
      posDbUri: (t.posDbUri as string) || "",
      posBranchId: (t.posBranchId as string) || "",
      posOrgId: (t.posOrgId as string) || "",
      emDbUri: (t.emDbUri as string) || "",
      emBranchId: (t.emBranchId as string) || "",
      emOrgId: (t.emOrgId as string) || "",
      qpay: {
        merchantServer: process.env.QPAY_MERCHANT_SERVER || "https://quickqr.qpay.mn/",
        server: process.env.QPAY_SERVER || "https://merchant.qpay.mn/",
        testServer: process.env.QPAY_TEST_SERVER || "https://merchant-sandbox.qpay.mn/",
        username: (t.qpayUsername as string) || process.env.QPAY_USERNAME || "",
        password: (t.qpayPassword as string) || process.env.QPAY_PASSWORD || "",
        terminalId: (t.qpayTerminalId as string) || process.env.QPAY_TERMINAL_ID || "",
        invoiceCode: (t.qpayInvoiceCode as string) || "",
        feeType: (t.qpayFeeType as string) || "CHARGE_PAYER",
        merchantName: (t.qpayMerchantName as string) || "",
        register: (t.qpayRegister as string) || "",
        phone: (t.qpayPhone as string) || "",
        email: (t.qpayEmail as string) || "",
        address: (t.qpayAddress as string) || "",
        city: (t.qpayCity as string) || "",
        district: (t.qpayDistrict as string) || "",
        mccCode: (t.qpayMccCode as string) || "",
        bankName: (t.qpayBankName as string) || "",
        bankAccount: (t.qpayBankAccount as string) || "",
        bankAccountName: (t.qpayBankAccountName as string) || "",
      },
      register: (t.register as string) || "",
      registerTurul: (t.registerTurul as string) || "Байгууллага",
      branches: Array.isArray(t.branches) ? t.branches : [],
      promo: {
        visible: t.promoVisible ?? true,
        label: t.promoLabel ?? "Хязгаартай",
        discount: t.promoDiscount ?? "30% OFF",
        subtitle: t.promoSubtitle ?? "",
        href: t.promoHref ?? "/",
      },
      shippingFee:           typeof t.shippingFee === "number" ? t.shippingFee : 15000,
      shippingFreeThreshold: typeof t.shippingFreeThreshold === "number" ? t.shippingFreeThreshold : 500000,
      ebarimtTin:            (t.ebarimtTin as string) || "",
      ebarimtDistrict:       (t.ebarimtDistrict as string) || "",
      ebarimtKhoroo:         (t.ebarimtKhoroo as string) || "",
      ebarimtEnabled:        !!t.ebarimtEnabled,
      ebarimtAutoSend:       !!t.ebarimtAutoSend,
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
      description,
      locations,
      bannerTitle,
      bannerSubtitle,
      bannerSlidesBig,
      bannerSlidesSmall,
      bentoTiles,
      bentoTitle,
      contactEmail,
      contactPhone,
      address,
      features,
      promoVisible,
      promoLabel,
      promoDiscount,
      promoSubtitle,
      promoHref,
      posDbUri,
      posBranchId,
      posOrgId,
      emDbUri,
      emBranchId,
      emOrgId,
      qpayUsername,
      qpayPassword,
      qpayTerminalId,
      qpayInvoiceCode,
      qpayFeeType,
      qpayMerchantName,
      qpayRegister,
      qpayPhone,
      qpayEmail,
      qpayAddress,
      qpayCity,
      qpayDistrict,
      qpayMccCode,
      qpayBankName,
      qpayBankAccount,
      qpayBankAccountName,
      register,
      registerTurul,
      branches,
      shippingFee,
      shippingFreeThreshold,
      ebarimtTin,
      ebarimtDistrict,
      ebarimtKhoroo,
      ebarimtEnabled,
      ebarimtAutoSend,
    } = req.body;

    if (storeName !== undefined) tenant.name = storeName;
    if (logo !== undefined) tenant.logo = logo;
    if (primaryColor !== undefined) tenant.primaryColor = primaryColor;
    if (description !== undefined) tenant.description = description;
    if (locations !== undefined) tenant.locations = locations;
    if (bannerTitle !== undefined) tenant.bannerTitle = bannerTitle;
    if (bannerSubtitle !== undefined) tenant.bannerSubtitle = bannerSubtitle;
    if (bannerSlidesBig !== undefined) tenant.bannerSlidesBig = bannerSlidesBig;
    if (bannerSlidesSmall !== undefined) tenant.bannerSlidesSmall = bannerSlidesSmall;
    if (bentoTiles  !== undefined) tenant.bentoTiles  = bentoTiles;
    if (bentoTitle  !== undefined) tenant.bentoTitle  = bentoTitle;
    if (contactEmail !== undefined) tenant.contactEmail = contactEmail;
    if (contactPhone !== undefined) tenant.contactPhone = contactPhone;
    if (address !== undefined) tenant.address = address;
    if (features !== undefined) tenant.features = features;
    if (promoVisible !== undefined) tenant.promoVisible = promoVisible;
    if (promoLabel !== undefined) tenant.promoLabel = promoLabel;
    if (promoDiscount !== undefined) tenant.promoDiscount = promoDiscount;
    if (promoSubtitle !== undefined) tenant.promoSubtitle = promoSubtitle;
    if (promoHref !== undefined) tenant.promoHref = promoHref;
    if (posDbUri !== undefined) tenant.posDbUri = posDbUri;
    if (posBranchId !== undefined) tenant.posBranchId = posBranchId;
    if (posOrgId !== undefined) tenant.posOrgId = posOrgId;
    if (emDbUri !== undefined) (tenant as any).emDbUri = emDbUri;
    if (emBranchId !== undefined) (tenant as any).emBranchId = emBranchId;
    if (emOrgId !== undefined) (tenant as any).emOrgId = emOrgId;
    if (qpayUsername !== undefined) (tenant as any).qpayUsername = qpayUsername;
    if (qpayPassword !== undefined) (tenant as any).qpayPassword = qpayPassword;
    if (qpayTerminalId !== undefined) (tenant as any).qpayTerminalId = qpayTerminalId;
    if (qpayInvoiceCode !== undefined) (tenant as any).qpayInvoiceCode = qpayInvoiceCode;
    if (qpayFeeType !== undefined) (tenant as any).qpayFeeType = qpayFeeType;
    if (qpayMerchantName !== undefined) (tenant as any).qpayMerchantName = qpayMerchantName;
    if (qpayRegister !== undefined) (tenant as any).qpayRegister = qpayRegister;
    if (qpayPhone !== undefined) (tenant as any).qpayPhone = qpayPhone;
    if (qpayEmail !== undefined) (tenant as any).qpayEmail = qpayEmail;
    if (qpayAddress !== undefined) (tenant as any).qpayAddress = qpayAddress;
    if (qpayCity !== undefined) (tenant as any).qpayCity = qpayCity;
    if (qpayDistrict !== undefined) (tenant as any).qpayDistrict = qpayDistrict;
    if (qpayMccCode !== undefined) (tenant as any).qpayMccCode = qpayMccCode;
    if (qpayBankName !== undefined) (tenant as any).qpayBankName = qpayBankName;
    if (qpayBankAccount !== undefined) (tenant as any).qpayBankAccount = qpayBankAccount;
    if (qpayBankAccountName !== undefined) (tenant as any).qpayBankAccountName = qpayBankAccountName;
    if (register !== undefined) (tenant as any).register = register;
    if (registerTurul !== undefined) (tenant as any).registerTurul = registerTurul;
    if (branches !== undefined) (tenant as any).branches = branches;
    if (shippingFee !== undefined) (tenant as any).shippingFee = shippingFee;
    if (shippingFreeThreshold !== undefined) (tenant as any).shippingFreeThreshold = shippingFreeThreshold;
    if (ebarimtTin !== undefined) (tenant as any).ebarimtTin = ebarimtTin;
    if (ebarimtDistrict !== undefined) (tenant as any).ebarimtDistrict = ebarimtDistrict;
    if (ebarimtKhoroo !== undefined) (tenant as any).ebarimtKhoroo = ebarimtKhoroo;
    if (ebarimtEnabled !== undefined) (tenant as any).ebarimtEnabled = ebarimtEnabled;
    if (ebarimtAutoSend !== undefined) (tenant as any).ebarimtAutoSend = ebarimtAutoSend;

    await tenant.save();

    res.json({ success: true, message: "Settings updated" });
  } catch (e) {
    next(e);
  }
});
