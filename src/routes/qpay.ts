import { Router } from "express";
import axios from "axios";
import mongoose from "mongoose";
import { createRequire } from "module";
import { Tenant } from "../models/Tenant.js";
import { requireAdminAuth } from "../middleware/adminAuth.js";
import fs from "fs";
import path from "path";

const require = createRequire(import.meta.url);

// Patch mongoose.model to not throw on re-compilation (quickqpaypackv2/zevbackv2 call conn.model with schema repeatedly)
// Pre-register models that zevbackv2/quickqpaypackv2 will try to create on the same connection
// to avoid "Cannot overwrite model once compiled" errors
if (!mongoose.models.token) {
  mongoose.model("token", new mongoose.Schema({
    baiguullagiinId: String, barilgiinId: String, token: String,
    turul: String, refreshToken: String, expires_in: Date, ognoo: Date,
  }, { timestamps: true }));
}
if (!mongoose.models.QpayKhariltsagch) {
  mongoose.model("QpayKhariltsagch", new mongoose.Schema({
    type: String, register_number: String, baiguullagiinId: String,
    name: String, first_name: String, last_name: String, business_name: String,
    owner_last_name: String, owner_first_name: String, company_name: String,
    mcc_code: String, merchant_id: String, merchant_idTrue: String, merchant_idFalse: String,
    city: String, district: String, address: String, phone: String, email: String,
    salbaruud: [mongoose.Schema.Types.Mixed],
  }, { timestamps: true }));
}
if (!mongoose.models.QuickQpayObject) {
  mongoose.model("QuickQpayObject", new mongoose.Schema({
    gereeniiId: String, zogsooliinId: String, zogsoolUilchluulegch: mongoose.Schema.Types.Mixed,
    baiguullagiinId: String, zakhialgiinDugaar: String, salbariinId: String,
    tulsunEsekh: Boolean, ognoo: Date, qpay: mongoose.Schema.Types.Mixed,
    payment_id: String, legacy_id: String, invoice_id: String,
  }));
}
if (!mongoose.models.dugaarlalt) {
  mongoose.model("dugaarlalt", new mongoose.Schema({
    baiguullagiinId: String, barilgiinId: String, turul: String,
    ognoo: Date, dugaar: Number,
  }, { timestamps: true }));
}
const { qpayGargaya, qpayShalgay, qpayKhariltsagchUusgey, QuickQpayObject, QpayKhariltsagch } = require("quickqpaypackv2");

function logToFile(message: string, data?: any) {
  try {
    const logDir = path.resolve("logs");
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    const logPath = path.join(logDir, "qpay.log");
    const timestamp = new Date().toISOString();
    const formattedData = data ? `\nData: ${JSON.stringify(data, null, 2)}` : "";
    const logLine = `[${timestamp}] ${message}${formattedData}\n\n`;
    fs.appendFileSync(logPath, logLine, "utf8");
    console.log(`[QPay FileLog] ${message}`, data ? JSON.stringify(data) : "");
  } catch (err) {
    console.error("Failed to write to log file:", err);
  }
}

function getBankCode(bankName: string): string {
  if (!bankName) return "050000";
  const name = bankName.toLowerCase().trim();
  if (name.includes("хаан") || name.includes("khan")) return "050000";
  if (name.includes("голомт") || name.includes("golomt")) return "150000";
  if (name.includes("худалдаа") || name.includes("tdb") || name.includes("ххб")) return "040000";
  if (name.includes("төрийн") || name.includes("төр") || name.includes("state")) return "340000";
  if (name.includes("хас") || name.includes("xac") || name.includes("has")) return "220000";
  if (name.includes("капитрон") || name.includes("capitron")) return "300000";
  if (name.includes("богд") || name.includes("bogd")) return "320000";
  if (name.includes("ариг") || name.includes("arig")) return "210000";
  if (name.includes("чингис") || name.includes("chinggis")) return "260000";
  if (name.includes("тээвэр") || name.includes("trans")) return "380000";
  if (name.includes("м банк") || name === "m bank" || name === "m" || name.includes("mbank")) return "020000";
  if (/^\d{6}$/.test(bankName)) return bankName;
  return "050000";
}

// ── Local invoice tracker ─────────────────────────────────────────────────────
const QpayInvoiceSchema = new mongoose.Schema({
  tenantId:          String,
  zakhialgiinDugaar: { type: String, index: true },
  invoiceId:         String,
  qpayData:          mongoose.Schema.Types.Mixed,
  paid:              { type: Boolean, default: false },
  amount:            { type: Number, default: 0 },
  createdAt:         { type: Date, default: Date.now },
});
const QpayInvoice = mongoose.models.QpayInvoice ?? mongoose.model("QpayInvoice", QpayInvoiceSchema);

const QPAY_BASE = (process.env.QPAY_MERCHANT_SERVER ?? "https://quickqr.qpay.mn").replace(/\/$/, "");

export const qpayRouter = Router();

// ── Auth ──────────────────────────────────────────────────────────────────────

async function qpayToken(customUser?: string, customPass?: string, customTerminal?: string): Promise<string> {
  const username = customUser || process.env.QPAY_USERNAME;
  const password = customPass || process.env.QPAY_PASSWORD;
  const terminalId = customTerminal || process.env.QPAY_TERMINAL_ID || "95000059";
  if (!username || !password) throw new Error("QPay credentials missing.");
  const creds = Buffer.from(`${username}:${password}`).toString("base64");
  const { data } = await axios.post(
    `${QPAY_BASE}/v2/auth/token`,
    JSON.stringify({ terminal_id: terminalId }),
    { headers: { Authorization: `Basic ${creds}`, "Content-Type": "application/json" } },
  );
  if (!data?.access_token) throw new Error("QPay auth failed");
  return data.access_token;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function resolveTenant(req: any) {
  const a = req.admin;
  const id = a?.role === "superadmin"
    ? (req.params.tenantId ?? req.body.tenantId ?? req.query.tenantId)
    : a?.tenantId;
  return id ? Tenant.findById(id) : null;
}

async function resolveTenantByHost(req: any) {
  const tenantId = req.query.tenantId as string | undefined;
  if (tenantId) return Tenant.findById(tenantId);
  const slug = req.query.tenant as string | undefined;
  if (slug) return Tenant.findOne({ slug: slug.toLowerCase().trim(), status: "active" });
  const host = ((req.headers["x-tenant-host"] ?? req.headers.host ?? "") as string).split(":")[0].toLowerCase();
  const isIp = /^\d+\.\d+\.\d+\.\d+$/.test(host);
  if (!isIp && host && host !== "localhost") {
    return (
      await Tenant.findOne({ domain: host, status: "active" }) ??
      await Tenant.findOne({ slug: host.split(".")[0], status: "active" })
    );
  }
  return Tenant.findOne({ status: "active" });
}

// ── POST /api/qpay/register-merchant ─────────────────────────────────────────

qpayRouter.post("/register-merchant", requireAdminAuth, async (req, res) => {
  try {
    const tenant = await resolveTenant(req);
    if (!tenant) { res.status(404).json({ error: "Tenant not found" }); return; }
    const t = tenant as any;

    // Build khariltsagch object for quickqpaypackv2
    const isPerson = t.registerTurul === "Хувь хүн";
    const khariltsagch: any = {
      type:            isPerson ? "PERSON" : "COMPANY",
      register_number: t.qpayRegister ?? "",
      baiguullagiinId: String(tenant._id),
      mcc_code:        t.qpayMccCode ?? "5311",
      city:            t.qpayCity ?? "",
      district:        t.qpayDistrict ?? "",
      address:         t.qpayAddress ?? "",
      phone:           t.qpayPhone ?? "",
      email:           t.qpayEmail ?? "",
      salbaruud: [
        {
          salbariinId:      String(tenant._id),
          salbariinNer:     t.name || t.qpayMerchantName || "",
          qpayShimtgelTurul: t.qpayFeeType === "CHARGE_MERCHANT",
          bank_accounts: [
            {
              account_bank_code: getBankCode(t.qpayBankName),
              account_number:    t.qpayBankAccount,
              account_name:      t.qpayBankAccountName || t.name,
              is_default:        true,
              qpayShimtgelTurul: t.qpayFeeType === "CHARGE_MERCHANT",
            }
          ]
        }
      ]
    };

    if (isPerson) {
      khariltsagch.first_name    = t.qpayMerchantName ?? "";
      khariltsagch.last_name     = t.qpayMerchantName ?? "";
      khariltsagch.business_name = t.qpayMerchantName ?? "";
    } else {
      khariltsagch.name              = t.qpayMerchantName ?? "";
      khariltsagch.owner_first_name  = t.qpayMerchantName ?? "";
      khariltsagch.owner_last_name   = t.qpayMerchantName ?? "";
      khariltsagch.company_name      = t.qpayMerchantName ?? "";
    }

    const result = await qpayKhariltsagchUusgey(khariltsagch, { kholbolt: mongoose });

    if (result === "Amjilttai") {
      // Read back the saved merchant to get merchant_id
      const QpayKhariltsagchModel = QpayKhariltsagch({ kholbolt: mongoose });
      const saved = await QpayKhariltsagchModel.findOne({ baiguullagiinId: String(tenant._id) });
      if (saved?.merchant_id) {
        await (tenant as any).updateOne({ qpayMerchantId: saved.merchant_id });
      }
      res.json({ success: true, data: saved });
    } else {
      res.status(400).json({ success: false, error: result });
    }
  } catch (e: any) {
    console.error("[QPay register-merchant]", e?.message);
    res.status(500).json({ success: false, error: e?.message });
  }
});

// ── GET /api/qpay/merchant ────────────────────────────────────────────────────

qpayRouter.get("/merchant", requireAdminAuth, async (req, res) => {
  try {
    const tenant = await resolveTenant(req);
    if (!tenant) { res.status(404).json({ error: "Tenant not found" }); return; }
    const token = await qpayToken((tenant as any).qpayUsername, (tenant as any).qpayPassword, (tenant as any).qpayTerminalId);
    const { data } = await axios.get(
      `${QPAY_BASE}/v2/merchant?register_number=${encodeURIComponent((tenant as any).qpayRegister ?? "")}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    res.json({ data });
  } catch (e: any) {
    res.status(e?.response?.status ?? 500).json({ error: e?.response?.data ?? e?.message });
  }
});

// ── POST /api/qpay/invoice ────────────────────────────────────────────────────

qpayRouter.post("/invoice", async (req, res, next) => {
  try {
    const tenant = await resolveTenantByHost(req);
    if (!tenant) { res.status(404).json({ error: "Tenant not found" }); return; }
    const t = tenant as any;

    const { zakhialgiinDugaar, dun, tailbar } = req.body;
    if (!zakhialgiinDugaar || !dun) {
      res.status(400).json({ error: "zakhialgiinDugaar and dun are required" }); return;
    }

    const amount = Number(dun);
    if (!amount || amount <= 0) {
      res.status(400).json({ error: "Invalid amount" }); return;
    }

    const host = process.env.SERVER_HOST ?? "103.236.194.106";
    const port = process.env.PORT ?? "8000";
    const callback_url = `http://${host}:${port}/api/qpay/callback/${String(tenant._id)}/${zakhialgiinDugaar}`;

    // Use quickqpaypackv2 qpayGargaya — same as udirdlagaBack
    const body: any = {
      baiguullagiinId: String(tenant._id),
      barilgiinId:     String(tenant._id), // salbariinId = tenantId
      dun:             amount,
      tulbur:          amount,
      tailbar:         tailbar ?? `Төлбөр ${zakhialgiinDugaar}`,
      zakhialgiinDugaar,
      dansniiDugaar:   t.qpayBankAccount || undefined,
    };

    logToFile("Calling qpayGargaya", { body, callback_url });

    const khariu = await qpayGargaya(body, callback_url, { kholbolt: mongoose });

    if (typeof khariu === "string") {
      // Error string returned
      res.status(400).json({ success: false, error: khariu });
      return;
    }

    logToFile("qpayGargaya success", khariu);

    // Also save to our local tracker
    await QpayInvoice.findOneAndUpdate(
      { zakhialgiinDugaar },
      { tenantId: String(tenant._id), invoiceId: khariu.id, qpayData: khariu, paid: false, amount },
      { upsert: true, new: true },
    );

    res.json({ success: true, data: khariu });
  } catch (e: any) {
    logToFile("QPay invoice error", { message: e?.message });
    res.status(500).json({ success: false, error: e?.message });
  }
});

// ── GET /api/qpay/callback/:tenantId/:zakhialgiinDugaar ───────────────────────

qpayRouter.get("/callback/:tenantId/:zakhialgiinDugaar", async (req, res, next) => {
  try {
    const { zakhialgiinDugaar } = req.params;
    logToFile("QPay callback received", { zakhialgiinDugaar });

    await QpayInvoice.findOneAndUpdate({ zakhialgiinDugaar }, { paid: true });

    // Also mark in QuickQpayObject collection
    try {
      const QpayObjModel = QuickQpayObject({ kholbolt: mongoose });
      await QpayObjModel.findOneAndUpdate(
        { zakhialgiinDugaar, tulsunEsekh: false },
        { tulsunEsekh: true },
      );
    } catch (_) {}

    (req as any).app.get("socketio")?.emit("qpay" + zakhialgiinDugaar);
    res.sendStatus(200);
  } catch (e) {
    next(e);
  }
});

// ── POST /api/qpay/check ──────────────────────────────────────────────────────

qpayRouter.post("/check", async (req, res, next) => {
  try {
    const { zakhialgiinDugaar } = req.body;
    const obj = await QpayInvoice.findOne({ zakhialgiinDugaar }).lean();
    res.json({ data: obj ?? null });
  } catch (e) {
    next(e);
  }
});
