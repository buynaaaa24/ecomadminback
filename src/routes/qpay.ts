import { Router } from "express";
import { createRequire } from "module";
import { Tenant } from "../models/Tenant.js";
import { requireAdminAuth } from "../middleware/adminAuth.js";

// quickqpaypack is a CommonJS package — use createRequire in ESM
const require = createRequire(import.meta.url);
console.log("[QPay] Loading quickqpaypack...");
let QuickQpayObject: any, QpayKhariltsagch: any, qpayKhariltsagchUusgey: any, qpayGargaya: any;
try {
  const pkg = require("quickqpaypack");
  QuickQpayObject = pkg.QuickQpayObject;
  QpayKhariltsagch = pkg.QpayKhariltsagch;
  qpayKhariltsagchUusgey = pkg.qpayKhariltsagchUusgey;
  qpayGargaya = pkg.qpayGargaya;
  console.log("[QPay] quickqpaypack loaded. exports:", Object.keys(pkg));
} catch (e: any) {
  console.error("[QPay] FAILED to load quickqpaypack:", e.message);
}

export const qpayRouter = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Resolve tenant from JWT admin context or by tenantId query/body param */
async function resolveTenant(req: any) {
  const a = req.admin;
  // superadmin passes tenantId explicitly
  if (a?.role === "superadmin") {
    const id = req.params.tenantId ?? req.body.tenantId ?? req.query.tenantId;
    if (id) return Tenant.findById(id);
  }
  // regular admin uses their own tenant
  if (a?.tenantId) return Tenant.findById(a.tenantId);
  return null;
}

// ─── POST /api/qpay/register-merchant ─────────────────────────────────────────
// Registers the tenant as a QPay merchant using the saved QPay fields.
// Calls qpayKhariltsagchUusgey from quickqpaypack (mirrors posBackv2).
qpayRouter.post("/register-merchant", requireAdminAuth, async (req, res, next) => {
  console.log("[QPay step 1] register-merchant hit, admin:", JSON.stringify(req.admin));
  try {
    console.log("[QPay step 2] resolving tenant, body.tenantId:", req.body.tenantId);
    const tenant = await resolveTenant(req);
    console.log("[QPay step 3] tenant:", tenant ? String((tenant as any)._id) : "NULL");
    if (!tenant) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Tenant not found" } });
      return;
    }

    const t = tenant as any;

    const body: Record<string, unknown> = {
      // Required by quickqpaypack internals
      baiguullagiinId: String(tenant._id),
      // Merchant identity — field names must match what posBackv2 sends to the package
      type:            "COMPANY",
      name:            t.qpayMerchantName   || "",
      register_number: t.qpayRegister       || "",
      register:        t.qpayRegister       || "",
      phone:           t.qpayPhone          || "",
      email:           t.qpayEmail          || "",
      address:         t.qpayAddress        || "",
      city:            t.qpayCity           || "",
      district:        t.qpayDistrict       || "",
      mcc_code:        t.qpayMccCode        || "",
      fee_type:        t.qpayFeeType        || "CHARGE_PAYER",
      // Bank account as salbaruud array (format expected by QPay)
      salbaruud: [
        {
          salbariinId:  String(tenant._id),
          salbariinNer: t.qpayMerchantName || "",
          bank_accounts: [
            {
              account_bank_name:   t.qpayBankName        || "",
              account_number:      t.qpayBankAccount     || "",
              account_name:        t.qpayBankAccountName || "",
              is_default:          true,
            },
          ],
        },
      ],
    };

    console.log("[QPay step 4] ENV:", {
      QPAY_MERCHANT_SERVER: process.env.QPAY_MERCHANT_SERVER ?? "NOT SET",
      QPAY_USERNAME: process.env.QPAY_USERNAME ? "SET" : "NOT SET",
      QPAY_PASSWORD: process.env.QPAY_PASSWORD ? "SET" : "NOT SET",
    });
    console.log("[QPay step 5] body:", JSON.stringify(body, null, 2));
    console.log("[QPay step 6] qpayKhariltsagchUusgey typeof:", typeof qpayKhariltsagchUusgey);

    let khariu: any;
    try {
      khariu = await qpayKhariltsagchUusgey(body);
    } catch (innerErr: any) {
      console.error("[QPay registerMerchant] THREW:", innerErr);
      console.error("[QPay registerMerchant] typeof:", typeof innerErr);
      console.error("[QPay registerMerchant] keys:", Object.keys(innerErr ?? {}));
      console.error("[QPay registerMerchant] JSON:", JSON.stringify(innerErr, Object.getOwnPropertyNames(innerErr)));
      res.status(500).json({
        success: false,
        error: {
          message: innerErr?.message ?? String(innerErr),
          code: innerErr?.code,
          status: innerErr?.response?.status,
          responseData: innerErr?.response?.data,
          stack: innerErr?.stack,
          raw: JSON.parse(JSON.stringify(innerErr, Object.getOwnPropertyNames(innerErr))),
        },
      });
      return;
    }

    console.log("[QPay registerMerchant] khariu:", JSON.stringify(khariu, null, 2));

    // Package may return an error object instead of throwing
    if (khariu && (khariu.aldaa || khariu.error || khariu.success === false)) {
      console.error("[QPay registerMerchant] package returned error object:", khariu);
      res.status(500).json({ success: false, error: khariu });
      return;
    }

    res.json({ success: true, data: khariu });
  } catch (e: any) {
    console.error("[QPay registerMerchant] outer catch:", e);
    console.error("[QPay registerMerchant] outer JSON:", JSON.stringify(e, Object.getOwnPropertyNames(e ?? {})));
    res.status(500).json({
      success: false,
      error: {
        message: e?.message ?? String(e),
        stack: e?.stack,
        raw: JSON.parse(JSON.stringify(e, Object.getOwnPropertyNames(e ?? {}))),
      },
    });
  }
});

// ─── GET /api/qpay/merchant ───────────────────────────────────────────────────
// Fetch the existing QpayKhariltsagch record for this tenant.
qpayRouter.get("/merchant", requireAdminAuth, async (req, res, next) => {
  try {
    const tenant = await resolveTenant(req);
    if (!tenant) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Tenant not found" } });
      return;
    }
    const khariu = await QpayKhariltsagch.findOne({
      baiguullagiinId: String(tenant._id),
    });
    res.json({ data: khariu ?? null });
  } catch (e) {
    next(e);
  }
});

// ─── POST /api/qpay/invoice ───────────────────────────────────────────────────
// Create a QPay payment invoice for an order (called from checkout/storefront).
// Body: { orderId, zakhialgiinDugaar, dun, tailbar, barilgiinId?, salbariinId? }
qpayRouter.post("/invoice", async (req, res, next) => {
  try {
    // Resolve tenant from x-tenant-host or tenant query param
    const raw = (req.headers["x-tenant-host"] ?? req.headers.host ?? "") as string;
    const host = raw.split(":")[0].toLowerCase().trim();
    const querySlug = req.query.tenant as string | undefined;

    let tenant = null;
    if (querySlug) {
      tenant = await Tenant.findOne({ slug: querySlug.toLowerCase().trim(), status: "active" });
    } else {
      const isIp = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
      if (host && host !== "localhost" && host !== "127.0.0.1" && !isIp) {
        tenant = await Tenant.findOne({ domain: host, status: "active" });
        if (!tenant) tenant = await Tenant.findOne({ slug: host.split(".")[0], status: "active" });
      } else {
        tenant = await Tenant.findOne({ status: "active" });
      }
    }

    if (!tenant) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Tenant not found" } });
      return;
    }

    const t = tenant as any;
    const { zakhialgiinDugaar, dun, tailbar, barilgiinId, salbariinId } = req.body;

    if (!zakhialgiinDugaar || !dun) {
      res.status(400).json({ error: { code: "BAD_REQUEST", message: "zakhialgiinDugaar and dun are required" } });
      return;
    }

    const serverHost = process.env.SERVER_HOST || process.env.UNDSEN_IP || "103.236.194.106";
    const serverPort = process.env.PORT || "8000";

    const callback_url = `http://${serverHost}:${serverPort}/api/qpay/callback/${String(tenant._id)}/${zakhialgiinDugaar}`;

    const body: Record<string, unknown> = {
      baiguullagiinId: String(tenant._id),
      salbariinId:     barilgiinId || salbariinId || String(tenant._id),
      barilgiinId:     barilgiinId || String(tenant._id),
      zakhialgiinDugaar,
      dun,
      tailbar:         tailbar || ("Төлбөр " + zakhialgiinDugaar),
      username:        t.qpayUsername || process.env.QPAY_USERNAME || "",
      password:        t.qpayPassword || process.env.QPAY_PASSWORD || "",
    };

    console.log("[QPay invoice] tenantId:", String(tenant._id), "order:", zakhialgiinDugaar);

    const khariu = await qpayGargaya(body, callback_url);
    res.json({ success: true, data: khariu });
  } catch (e: any) {
    console.error("[QPay invoice] error:", e?.message);
    next(e);
  }
});

// ─── GET /api/qpay/callback/:tenantId/:zakhialgiinDugaar ──────────────────────
// QPay server calls this URL after successful payment.
qpayRouter.get("/callback/:tenantId/:zakhialgiinDugaar", async (req, res, next) => {
  try {
    const { zakhialgiinDugaar } = req.params;
    console.log("[QPay callback] zakhialgiinDugaar:", zakhialgiinDugaar);

    const qpayObject = await QuickQpayObject.findOne({ zakhialgiinDugaar });
    if (qpayObject) {
      qpayObject.tulsunEsekh = true;
      qpayObject.isNew = false;
      await qpayObject.save();

      // Emit socket event so the storefront can react in real-time
      const io = (req as any).app.get("socketio");
      if (io) io.emit("qpay" + zakhialgiinDugaar);
    } else {
      console.warn("[QPay callback] QuickQpayObject not found for:", zakhialgiinDugaar);
    }

    res.sendStatus(200);
  } catch (e) {
    next(e);
  }
});

// ─── POST /api/qpay/check ─────────────────────────────────────────────────────
// Check payment status for a given order number.
// Body: { zakhialgiinDugaar, baiguullagiinId?, salbariinId? }
qpayRouter.post("/check", async (req, res, next) => {
  try {
    const { zakhialgiinDugaar, baiguullagiinId, salbariinId } = req.body;
    const qpayObject = await QuickQpayObject.findOne({
      ...(baiguullagiinId ? { baiguullagiinId } : {}),
      ...(salbariinId ? { salbariinId } : {}),
      zakhialgiinDugaar,
    });
    res.json({ data: qpayObject ?? null });
  } catch (e) {
    next(e);
  }
});
