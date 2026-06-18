import { Router } from "express";
import { createRequire } from "module";
import axios from "axios";
import { Tenant } from "../models/Tenant.js";
import { requireAdminAuth } from "../middleware/adminAuth.js";

const require = createRequire(import.meta.url);
const { QuickQpayObject, qpayGargaya } = require("quickqpaypackv2");

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

    const token = await qpayToken();
    const { data } = await axios.post(
      `${QPAY_BASE}/v2/merchant`,
      {
        merchant_type:   "MERCHANT",
        business_type:   t.registerTurul === "Хувь хүн" ? "INDIVIDUAL" : "COMPANY",
        name:            t.qpayMerchantName   ?? "",
        register_number: t.qpayRegister       ?? "",
        phone:           t.qpayPhone          ?? "",
        email:           t.qpayEmail          ?? "",
        address:         t.qpayAddress        ?? "",
        city:            t.qpayCity           ?? "",
        district:        t.qpayDistrict       ?? "",
        mcc_code:        t.qpayMccCode        ?? "",
        fee_type:        t.qpayFeeType        ?? "CHARGE_PAYER",
        bank_accounts: [{
          account_bank_code: t.qpayBankName        ?? "",
          account_number:    t.qpayBankAccount     ?? "",
          account_name:      t.qpayBankAccountName ?? "",
          is_default:        true,
        }],
      },
      { headers: { Authorization: `Bearer ${token}` } },
    );

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

    const { zakhialgiinDugaar, dun, tailbar, salbariinId } = req.body;
    if (!zakhialgiinDugaar || !dun) {
      res.status(400).json({ error: "zakhialgiinDugaar and dun are required" });
      return;
    }

    const host = process.env.SERVER_HOST ?? "103.236.194.106";
    const port = process.env.PORT ?? "8000";
    const callback_url = `http://${host}:${port}/api/qpay/callback/${String(tenant._id)}/${zakhialgiinDugaar}`;

    const khariu = await qpayGargaya(
      {
        baiguullagiinId:  String(tenant._id),
        salbariinId:      salbariinId ?? String(tenant._id),
        zakhialgiinDugaar,
        dun,
        tailbar:          tailbar ?? `Төлбөр ${zakhialgiinDugaar}`,
        username:         process.env.QPAY_USERNAME ?? "",
        password:         process.env.QPAY_PASSWORD ?? "",
      },
      callback_url,
    );
    res.json({ success: true, data: khariu });
  } catch (e: any) {
    console.error("[QPay invoice]", e?.message);
    next(e);
  }
});

// ── GET /api/qpay/callback/:tenantId/:zakhialgiinDugaar ───────────────────────

qpayRouter.get("/callback/:tenantId/:zakhialgiinDugaar", async (req, res, next) => {
  try {
    const { zakhialgiinDugaar } = req.params;
    const obj = await QuickQpayObject.findOne({ zakhialgiinDugaar });
    if (obj) {
      obj.tulsunEsekh = true;
      obj.isNew = false;
      await obj.save();
      (req as any).app.get("socketio")?.emit("qpay" + zakhialgiinDugaar);
    }
    res.sendStatus(200);
  } catch (e) {
    next(e);
  }
});

// ── POST /api/qpay/check ──────────────────────────────────────────────────────

qpayRouter.post("/check", async (req, res, next) => {
  try {
    const { zakhialgiinDugaar, baiguullagiinId, salbariinId } = req.body;
    const obj = await QuickQpayObject.findOne({
      zakhialgiinDugaar,
      ...(baiguullagiinId && { baiguullagiinId }),
      ...(salbariinId && { salbariinId }),
    });
    res.json({ data: obj ?? null });
  } catch (e) {
    next(e);
  }
});
