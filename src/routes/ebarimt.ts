import { Router } from "express";
import axios from "axios";

export const ebarimtRouter = Router();

// GET /api/ebarimt/resolve?regNo=6688845
ebarimtRouter.get("/resolve", async (req, res) => {
  try {
    const regNo = String(req.query.regNo || "").trim();
    if (!regNo || regNo.length !== 7) {
      res.status(400).json({ found: false, error: "Invalid register number" });
      return;
    }

    // 1. Try official public api.ebarimt.mn
    try {
      const url = `https://api.ebarimt.mn/api/info/check/getTinInfo?regNo=${encodeURIComponent(regNo)}`;
      const { data } = await axios.get(url, { headers: { Accept: "application/json" }, timeout: 4000 });
      if (data && (data.data || data.msg === "Амжилттай")) {
        const infoName = typeof data.data === "object" ? (data.data.name || data.data.vatpayerName) : (data.data || "Байгууллага");
        res.json({
          found: true,
          tin: String(data.data?.vatpayerNumber || data.data || regNo),
          info: { name: String(infoName) },
        });
        return;
      }
    } catch (_) {}

    // 2. Fallback to pos.zevtabs.mn helper
    try {
      const posRes = await axios.get(`https://pos.zevtabs.mn/api/tatvaraasBaiguullagaAvya/${encodeURIComponent(regNo)}`, { timeout: 4000 });
      if (posRes.data && posRes.data.found) {
        res.json({
          found: true,
          tin: posRes.data.tin || regNo,
          info: { name: posRes.data.name || "Байгууллага" },
        });
        return;
      }
    } catch (_) {}

    res.json({ found: false });
  } catch (err: any) {
    res.status(500).json({ found: false, error: err?.message || String(err) });
  }
});
