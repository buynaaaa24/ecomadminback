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

function getBankCode(bankName: string): string {
  if (!bankName) return "050000"; // Default to Khan Bank if empty
  
  const name = bankName.toLowerCase().trim();
  
  // Khan Bank
  if (name.includes("хаан") || name.includes("khan")) return "050000";
  // Golomt Bank
  if (name.includes("голомт") || name.includes("golomt")) return "150000";
  // Trade & Development Bank (TDB / ХХБ)
  if (name.includes("худалдаа") || name.includes("tdb") || name.includes("ххб")) return "040000";
  // State Bank
  if (name.includes("төрийн") || name.includes("төр") || name.includes("state")) return "340000";
  // Xac Bank
  if (name.includes("хас") || name.includes("xac") || name.includes("has")) return "220000";
  // Capitron
  if (name.includes("капитрон") || name.includes("capitron")) return "300000";
  // Bogd
  if (name.includes("богд") || name.includes("bogd")) return "320000";
  // Arig
  if (name.includes("ариг") || name.includes("arig")) return "210000";
  // Chinggis Khaan
  if (name.includes("чингис") || name.includes("chinggis")) return "260000";
  // Trans Bank
  if (name.includes("тээвэр") || name.includes("trans")) return "380000";
  // M Bank
  if (name.includes("м банк") || name === "m bank" || name === "m" || name.includes("mbank")) return "020000";

  // If it's already a 6-digit numeric string, return it directly
  if (/^\d{6}$/.test(bankName)) return bankName;

  return "050000"; // default fallback
}

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
  
  logToFile(`Attempting token generation. Username: ${username ? '***' + username.slice(-4) : 'undefined'}, Terminal ID: ${terminalId}`);
  
  if (!username || !password) {
    logToFile("QPay credentials (username/password) are missing.");
    throw new Error("QPay credentials (username/password) are missing.");
  }
  
  const creds = Buffer.from(`${username}:${password}`).toString("base64");
  try {
    const { data } = await axios.post(
      `${QPAY_BASE}/v2/auth/token`,
      JSON.stringify({ terminal_id: terminalId }),
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

    const token = await qpayToken(t.qpayUsername, t.qpayPassword, t.qpayTerminalId);

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
    if (!t.qpayMerchantId) {
      res.status(400).json({ error: "QPay merchant_id is not configured for this tenant" }); return;
    }
    if (!t.qpayBankAccount) {
      res.status(400).json({ error: "QPay bank account is not configured for this tenant" }); return;
    }

    const host = process.env.SERVER_HOST ?? "103.236.194.106";
    const port = process.env.PORT ?? "8000";
    const callback_url = `http://${host}:${port}/api/qpay/callback/${String(tenant._id)}/${zakhialgiinDugaar}`;

    const token = await qpayToken(t.qpayUsername, t.qpayPassword, t.qpayTerminalId);
    const amount = Number(dun);
    if (!amount || amount <= 0) {
      res.status(400).json({ error: "Invalid amount" }); return;
    }
    const invoicePayload = {
      merchant_id:           t.qpayMerchantId,
      amount,
      currency:              "MNT",
      description:           tailbar ?? `Төлбөр ${zakhialgiinDugaar}`,
      mcc_code:              t.qpayMccCode || "5311",
      callback_url,
      bank_accounts: [
        {
          account_bank_code: getBankCode(t.qpayBankName),
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
      { tenantId: String(tenant._id), invoiceId: data.id ?? data.invoice_id, qpayData: data, paid: false, amount },
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
    const { tenantId, zakhialgiinDugaar } = req.params;
    const invoice = await QpayInvoice.findOne({ zakhialgiinDugaar }).lean() as any;
    if (!invoice) { res.sendStatus(404); return; }

    // Verify payment with QPay
    const tenant = await Tenant.findById(tenantId) as any;
    if (tenant) {
      try {
        const token = await qpayToken(tenant.qpayUsername, tenant.qpayPassword, tenant.qpayTerminalId);
        const invoiceId = invoice.invoiceId;
        const { data: checkData } = await axios.post(
          `${QPAY_BASE}/v2/payment/check`,
          JSON.stringify({ object_type: "INVOICE", object_id: invoiceId }),
          { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } },
        );
        logToFile("QPay callback payment check", { zakhialgiinDugaar, checkData });
        // Verify amount matches
        const paidAmount = Number(checkData?.rows?.[0]?.payment_amount ?? checkData?.paid_amount ?? 0);
        const invoiceAmount = Number(invoice.amount ?? 0);
        if (paidAmount > 0 && invoiceAmount > 0 && paidAmount !== invoiceAmount) {
          logToFile("QPay amount mismatch", { paidAmount, invoiceAmount, zakhialgiinDugaar });
          res.status(400).json({ error: "Amount mismatch" }); return;
        }
      } catch (verifyErr: any) {
        logToFile("QPay callback verification failed", verifyErr?.message);
      }
    }

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
