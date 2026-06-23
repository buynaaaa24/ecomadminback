import { Router } from "express";
import axios from "axios";
import mongoose from "mongoose";
import { Tenant } from "../models/Tenant.js";
import { requireAdminAuth } from "../middleware/adminAuth.js";
import fs from "fs";
import path from "path";

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

const QpayInvoiceSchema = new mongoose.Schema({
  tenantId:          String,
  zakhialgiinDugaar: { type: String, index: true },
  invoiceId:         String,
  qpayData:          mongoose.Schema.Types.Mixed,
  paid:              { type: Boolean, default: false },
  createdAt:         { type: Date, default: Date.now },
});
const QpayInvoice = mongoose.models.QpayInvoice ?? mongoose.model("QpayInvoice", QpayInvoiceSchema);

const QPAY_BASE = (process.env.QPAY_MERCHANT_SERVER ?? "https://quickqr.qpay.mn").replace(/\/$/, "");

export const qpayRouter = Router();

// ── Auth ──────────────────────────────────────────────────────────────────────

async function qpayToken(customUser?: string, customPass?: string): Promise<string> {
  const username = customUser || process.env.QPAY_USERNAME;
  const password = customPass || process.env.QPAY_PASSWORD;
  
  logToFile(`Attempting token generation. Username: ${username ? '***' + username.slice(-4) : 'undefined'}`);
  
  if (!username || !password) {
    logToFile("QPay credentials (username/password) are missing.");
    throw new Error("QPay credentials (username/password) are missing.");
  }
  
  const creds = Buffer.from(`${username}:${password}`).toString("base64");
  try {
    const { data } = await axios.post(
      `${QPAY_BASE}/v2/auth/token`,
      JSON.stringify({ terminal_id: "95000059" }),
      { headers: { Authorization: `Basic ${creds}`, "Content-Type": "application/json" } },
    );
    if (!data?.access_token) {
      logToFile("QPay auth failed: Access token not returned.", data);
      throw new Error(`QPay auth failed: Access token not returned. Response: ${JSON.stringify(data)}`);
    }
    logToFile("Token successfully retrieved");
    return data.access_token;
  } catch (error: any) {
    logToFile("QPay Auth Error", error?.response?.data || error?.message);
    throw error;
  }
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

    const isPerson = t.registerTurul === "Хувь хүн";
    const urn = isPerson ? "v2/merchant/person" : "v2/merchant/company";

    const token = await qpayToken(t.qpayUsername, t.qpayPassword);

    const merchantBody: Record<string, unknown> = {
      type:            isPerson ? "PERSON" : "COMPANY",
      register_number: t.qpayRegister  ?? "",
      mcc_code:        t.qpayMccCode   ?? "",
      city:            t.qpayCity      ?? "",
      district:        t.qpayDistrict  ?? "",
      address:         t.qpayAddress   ?? "",
      phone:           t.qpayPhone     ?? "",
      email:           t.qpayEmail     ?? "",
    };

    if (isPerson) {
      merchantBody.first_name   = t.qpayMerchantName ?? "";
      merchantBody.last_name    = t.qpayMerchantName ?? "";
      merchantBody.business_name = t.qpayMerchantName ?? "";
    } else {
      merchantBody.owner_first_name = t.qpayMerchantName ?? "";
      merchantBody.owner_last_name  = t.qpayMerchantName ?? "";
      merchantBody.company_name     = t.qpayMerchantName ?? "";
      merchantBody.name             = t.qpayMerchantName ?? "";
    }

    const { data } = await axios.post(
      `${QPAY_BASE}/${urn}`,
      JSON.stringify(merchantBody),
      { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } },
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
    const token = await qpayToken((tenant as any).qpayUsername, (tenant as any).qpayPassword);
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
    if (!t.qpayMerchantId) {
      res.status(400).json({ error: "QPay merchant_id is not configured for this tenant" }); return;
    }
    if (!t.qpayBankAccount) {
      res.status(400).json({ error: "QPay bank account is not configured for this tenant" }); return;
    }

    const host = process.env.SERVER_HOST ?? "103.236.194.106";
    const port = process.env.PORT ?? "8000";
    const callback_url = `http://${host}:${port}/api/qpay/callback/${String(tenant._id)}/${zakhialgiinDugaar}`;

    const token = await qpayToken(t.qpayUsername, t.qpayPassword);
    const invoicePayload = {
      merchant_id:           t.qpayMerchantId,
      amount:                dun,
      currency:              "MNT",
      description:           tailbar ?? `Төлбөр ${zakhialgiinDugaar}`,
      mcc_code:              t.qpayMccCode || "5311",
      callback_url,
      bank_accounts: [
        {
          account_bank_code: t.qpayBankName || "050000",
          account_number:    t.qpayBankAccount,
          account_name:      t.qpayBankAccountName || t.name,
          is_default:        true,
        }
      ]
    };

    logToFile("Preparing request to QPay API", {
      url: `${QPAY_BASE}/v2/invoice`,
      payload: invoicePayload,
      tenantId: String(tenant._id),
      merchantId: t.qpayMerchantId,
    });

    const { data } = await axios.post(
      `${QPAY_BASE}/v2/invoice`,
      JSON.stringify(invoicePayload),
      { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } },
    );

    logToFile("QPay API response success", data);

    await QpayInvoice.findOneAndUpdate(
      { zakhialgiinDugaar },
      { tenantId: String(tenant._id), invoiceId: data.id, qpayData: data, paid: false },
      { upsert: true, new: true },
    );

    res.json({ success: true, data });
  } catch (e: any) {
    const err = e?.response?.data;
    logToFile("QPay invoice error", {
      message: e?.message,
      status: e?.response?.status,
      response: err,
    });
    res.status(e?.response?.status ?? 500).json({ success: false, error: err ?? e?.message });
  }
});

// ── GET /api/qpay/callback/:tenantId/:zakhialgiinDugaar ───────────────────────

qpayRouter.get("/callback/:tenantId/:zakhialgiinDugaar", async (req, res, next) => {
  try {
    const { zakhialgiinDugaar } = req.params;
    await QpayInvoice.findOneAndUpdate({ zakhialgiinDugaar }, { paid: true });
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
