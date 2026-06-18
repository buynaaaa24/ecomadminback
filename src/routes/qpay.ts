import { Router } from "express";
import axios from "axios";
import mongoose from "mongoose";
import { Tenant } from "../models/Tenant.js";
import { requireAdminAuth } from "../middleware/adminAuth.js";

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

async function qpayToken(): Promise<string> {
  const creds = Buffer.from(`${process.env.QPAY_USERNAME}:${process.env.QPAY_PASSWORD}`).toString("base64");
  const { data } = await axios.post(
    `${QPAY_BASE}/v2/auth/token`,
    JSON.stringify({ terminal_id: "95000059" }),
    { headers: { Authorization: `Basic ${creds}`, "Content-Type": "application/json" } },
  );
  if (!data?.access_token) throw new Error(`QPay auth failed: ${JSON.stringify(data)}`);
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

    const isPerson = t.registerTurul === "Хувь хүн";
    const urn = isPerson ? "v2/merchant/person" : "v2/merchant/company";

    const token = await qpayToken();

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
    const token = await qpayToken();
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
      res.status(400).json({ error: "QPay merchant not registered for this tenant" }); return;
    }

    const host = process.env.SERVER_HOST ?? "103.236.194.106";
    const port = process.env.PORT ?? "8000";
    const callback_url = `http://${host}:${port}/api/qpay/callback/${String(tenant._id)}/${zakhialgiinDugaar}`;

    const token = await qpayToken();
    const { data } = await axios.post(
      `${QPAY_BASE}/v2/invoice`,
      JSON.stringify({
        invoice_code:          t.qpayInvoiceCode ?? process.env.QPAY_INVOICE_CODE ?? "",
        sender_invoice_no:     zakhialgiinDugaar,
        invoice_receiver_code: "terminal",
        invoice_description:   tailbar ?? `Төлбөр ${zakhialgiinDugaar}`,
        amount:                dun,
        callback_url,
      }),
      { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } },
    );

    await QpayInvoice.findOneAndUpdate(
      { zakhialgiinDugaar },
      { tenantId: String(tenant._id), invoiceId: data.id, qpayData: data, paid: false },
      { upsert: true, new: true },
    );

    res.json({ success: true, data });
  } catch (e: any) {
    const err = e?.response?.data;
    console.error("[QPay invoice]", err ?? e?.message);
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
