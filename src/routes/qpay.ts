import { Router } from "express";
import axios from "axios";
import mongoose from "mongoose";
import { Tenant } from "../models/Tenant.js";
import { requireAdminAuth } from "../middleware/adminAuth.js";
import fs from "fs";
import path from "path";

// ── Models ────────────────────────────────────────────────────────────────────

const QpayKhariltsagchSchema = new mongoose.Schema({
  type: String,
  register_number: String,
  baiguullagiinId: { type: String, index: true },
  name: String,
  first_name: String,
  last_name: String,
  business_name: String,
  owner_last_name: String,
  owner_first_name: String,
  company_name: String,
  mcc_code: String,
  merchant_id: String,
  merchant_idTrue: String,
  merchant_idFalse: String,
  city: String,
  district: String,
  address: String,
  phone: String,
  email: String,
  salbaruud: [mongoose.Schema.Types.Mixed],
}, { timestamps: true });
const QpayKhariltsagch = mongoose.models.QpayKhariltsagch ?? mongoose.model("QpayKhariltsagch", QpayKhariltsagchSchema);

const QuickQpayObjectSchema = new mongoose.Schema({
  gereeniiId: String,
  zogsooliinId: String,
  zogsoolUilchluulegch: mongoose.Schema.Types.Mixed,
  baiguullagiinId: String,
  zakhialgiinDugaar: String,
  salbariinId: String,
  tulsunEsekh: Boolean,
  ognoo: Date,
  qpay: mongoose.Schema.Types.Mixed,
  payment_id: String,
  legacy_id: String,
  invoice_id: String,
});
const QuickQpayObject = mongoose.models.QuickQpayObject ?? mongoose.model("QuickQpayObject", QuickQpayObjectSchema);

const QpayTokenSchema = new mongoose.Schema({
  turul: String,
  token: String,
  refreshToken: String,
  expires_in: Date,
  ognoo: Date,
}, { timestamps: true });
const QpayToken = mongoose.models.qpaytoken ?? mongoose.model("qpaytoken", QpayTokenSchema);

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

// ── Config ────────────────────────────────────────────────────────────────────

const QPAY_BASE = (process.env.QPAY_MERCHANT_SERVER ?? "https://quickqr.qpay.mn").replace(/\/$/, "");

// Hardcoded credentials (same as quickqpaypackv2 uses internally)
const QPAY_CREDS = {
  shimtgelTrue:  { username: "ZEV_TABS1", password: "PB5RcI2g", terminal: "95000059", turul: "quickqpay" },
  shimtgelFalse: { username: "ZEV_TABS",  password: "IZljztNr", terminal: "95000059", turul: "quickqpay1" },
};

export const qpayRouter = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

function logToFile(message: string, data?: any) {
  try {
    const logDir = path.resolve("logs");
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    const logPath = path.join(logDir, "qpay.log");
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] ${message}${data ? `\nData: ${JSON.stringify(data, null, 2)}` : ""}\n\n`;
    fs.appendFileSync(logPath, line, "utf8");
    console.log(`[QPay] ${message}`, data ? JSON.stringify(data) : "");
  } catch (_) {}
}

function getBankCode(bankName: string): string {
  if (!bankName) return "050000";
  const n = bankName.toLowerCase().trim();
  if (n.includes("хаан") || n.includes("khan")) return "050000";
  if (n.includes("голомт") || n.includes("golomt")) return "150000";
  if (n.includes("худалдаа") || n.includes("tdb") || n.includes("ххб")) return "040000";
  if (n.includes("төрийн") || n.includes("төр") || n.includes("state")) return "340000";
  if (n.includes("хас") || n.includes("xac") || n.includes("has")) return "220000";
  if (n.includes("капитрон") || n.includes("capitron")) return "300000";
  if (n.includes("богд") || n.includes("bogd")) return "320000";
  if (n.includes("ариг") || n.includes("arig")) return "210000";
  if (n.includes("чингис") || n.includes("chinggis")) return "260000";
  if (n.includes("тээвэр") || n.includes("trans")) return "380000";
  if (n.includes("м банк") || n === "m bank" || n.includes("mbank")) return "020000";
  if (/^\d{6}$/.test(bankName)) return bankName;
  return "050000";
}

async function getQpayToken(shimtgel: boolean): Promise<string> {
  const cred = shimtgel ? QPAY_CREDS.shimtgelTrue : QPAY_CREDS.shimtgelFalse;

  // Check cached token
  const cached = await QpayToken.findOne({ turul: cred.turul, expires_in: { $gte: new Date() } });
  if (cached?.token) return cached.token as string;

  // Fetch new token
  const creds = Buffer.from(`${cred.username}:${cred.password}`).toString("base64");
  const { data } = await axios.post(
    `${QPAY_BASE}/v2/auth/token`,
    JSON.stringify({ terminal_id: cred.terminal }),
    { headers: { Authorization: `Basic ${creds}`, "Content-Type": "application/json" } },
  );
  if (!data?.access_token) throw new Error("QPay auth failed");

  // Cache it
  await QpayToken.updateOne(
    { turul: cred.turul },
    { token: data.access_token, refreshToken: data.refresh_token, expires_in: new Date(data.expires_in), ognoo: new Date() },
    { upsert: true },
  );
  return data.access_token;
}

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

    const isPerson = t.registerTurul === "Хувь хүн";
    const urn = isPerson ? "v2/merchant/person" : "v2/merchant/company";
    const shimtgel = t.qpayFeeType === "CHARGE_MERCHANT";

    const merchantBody: any = {
      type:            isPerson ? "PERSON" : "COMPANY",
      register_number: t.qpayRegister ?? "",
      mcc_code:        t.qpayMccCode ?? "5311",
      city:            t.qpayCity ?? "",
      district:        t.qpayDistrict ?? "",
      address:         t.qpayAddress ?? "",
      phone:           t.qpayPhone ?? "",
      email:           t.qpayEmail ?? "",
    };
    if (isPerson) {
      merchantBody.first_name = t.qpayMerchantName ?? "";
      merchantBody.last_name = t.qpayMerchantName ?? "";
      merchantBody.business_name = t.qpayMerchantName ?? "";
    } else {
      merchantBody.owner_first_name = t.qpayMerchantName ?? "";
      merchantBody.owner_last_name = t.qpayMerchantName ?? "";
      merchantBody.company_name = t.qpayMerchantName ?? "";
      merchantBody.name = t.qpayMerchantName ?? "";
    }

    const token = await getQpayToken(shimtgel);
    const { data } = await axios.post(
      `${QPAY_BASE}/${urn}`,
      JSON.stringify(merchantBody),
      { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } },
    );

    // Save to QpayKhariltsagch (same structure as quickqpaypackv2)
    const merchantIdField = shimtgel ? "merchant_idTrue" : "merchant_idFalse";
    await QpayKhariltsagch.findOneAndUpdate(
      { baiguullagiinId: String(tenant._id) },
      {
        ...merchantBody,
        baiguullagiinId: String(tenant._id),
        merchant_id: data.id,
        [merchantIdField]: data.id,
        salbaruud: [{
          salbariinId: String(tenant._id),
          salbariinNer: t.name || t.qpayMerchantName || "",
          qpayShimtgelTurul: shimtgel,
          bank_accounts: [{
            account_bank_code: getBankCode(t.qpayBankName),
            account_number: t.qpayBankAccount,
            account_name: t.qpayBankAccountName || t.name,
            is_default: true,
            qpayShimtgelTurul: shimtgel,
          }],
        }],
      },
      { upsert: true, new: true },
    );

    await (tenant as any).updateOne({ qpayMerchantId: data.id });
    res.json({ success: true, data });
  } catch (e: any) {
    const err = e?.response?.data;
    console.error("[QPay register-merchant]", err ?? e?.message);
    res.status(e?.response?.status ?? 500).json({ success: false, error: err ?? e?.message });
  }
});

// ── GET /api/qpay/merchant ────────────────────────────────────────────────────

qpayRouter.get("/merchant", requireAdminAuth, async (req, res) => {
  try {
    const tenant = await resolveTenant(req);
    if (!tenant) { res.status(404).json({ error: "Tenant not found" }); return; }
    const token = await getQpayToken(false);
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

    // Look up merchant from QpayKhariltsagch (same as qpayGargaya does)
    const khariltsagch = await QpayKhariltsagch.findOne({ baiguullagiinId: String(tenant._id) }).lean() as any;
    if (!khariltsagch) {
      res.status(400).json({ error: "Merchant not registered in QPay. Call register-merchant first." }); return;
    }

    // Find the salbar (branch)
    const salbar = khariltsagch.salbaruud?.find((s: any) => s.salbariinId === String(tenant._id));
    if (!salbar || !salbar.bank_accounts?.length) {
      res.status(400).json({ error: "No bank accounts configured for this merchant." }); return;
    }

    // Determine which bank account and token to use
    let bank = salbar.bank_accounts;
    let shimtgel = salbar.qpayShimtgelTurul ?? false;
    if (t.qpayBankAccount) {
      const found = bank.find((a: any) => a.account_number === t.qpayBankAccount);
      if (found) {
        bank = [found];
        if (found.qpayShimtgelTurul !== undefined) shimtgel = found.qpayShimtgelTurul;
      }
    }

    // Use correct merchant_id based on shimtgel type
    const merchantId = shimtgel
      ? (khariltsagch.merchant_idTrue || khariltsagch.merchant_id)
      : (khariltsagch.merchant_idFalse || khariltsagch.merchant_id);

    const token = await getQpayToken(shimtgel);

    const invoicePayload = {
      merchant_id: merchantId,
      amount,
      currency: "MNT",
      customer_name: khariltsagch.name || khariltsagch.first_name || "",
      customer_logo: "",
      allow_partial: false,
      minimum_amount: null,
      allow_exceed: false,
      maximum_amount: null,
      callback_url,
      description: tailbar ?? `Төлбөр ${zakhialgiinDugaar}`,
      mcc_code: khariltsagch.mcc_code || "5311",
      bank_accounts: bank,
    };

    logToFile("Creating QPay invoice", { invoicePayload });

    const { data } = await axios.post(
      `${QPAY_BASE}/v2/invoice`,
      JSON.stringify(invoicePayload),
      { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } },
    );

    logToFile("QPay invoice created", data);

    // Save to QuickQpayObject (compatible with udirdlagaBack)
    await QuickQpayObject.create({
      baiguullagiinId: String(tenant._id),
      salbariinId: String(tenant._id),
      zakhialgiinDugaar,
      ognoo: new Date(),
      tulsunEsekh: false,
      legacy_id: data.legacy_id,
      invoice_id: data.id,
      qpay: invoicePayload,
    });

    // Save to local tracker
    await QpayInvoice.findOneAndUpdate(
      { zakhialgiinDugaar },
      { tenantId: String(tenant._id), invoiceId: data.id, qpayData: data, paid: false, amount },
      { upsert: true, new: true },
    );

    res.json({ success: true, data });
  } catch (e: any) {
    const err = e?.response?.data;
    logToFile("QPay invoice error", { message: e?.message, response: err });
    res.status(e?.response?.status ?? 500).json({ success: false, error: err ?? e?.message });
  }
});

// ── GET /api/qpay/callback/:tenantId/:zakhialgiinDugaar ───────────────────────

qpayRouter.get("/callback/:tenantId/:zakhialgiinDugaar", async (req, res, next) => {
  try {
    const { zakhialgiinDugaar } = req.params;
    logToFile("QPay callback received", { zakhialgiinDugaar });

    await QpayInvoice.findOneAndUpdate({ zakhialgiinDugaar }, { paid: true });
    await QuickQpayObject.findOneAndUpdate(
      { zakhialgiinDugaar, tulsunEsekh: false },
      { tulsunEsekh: true },
    );

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
