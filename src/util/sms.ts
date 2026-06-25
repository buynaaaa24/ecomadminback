import axios from "axios";

const CALLPRO_KEY = process.env.CALLPRO_KEY ?? "aa8e588459fdd9b7ac0b809fc29cfae3";
const CALLPRO_FROM = process.env.CALLPRO_FROM ?? "72002002";
const CALLPRO_URL = process.env.CALLPRO_URL ?? "https://api-text.callpro.mn/v1/sms/send";

export async function sendSms(to: string, text: string): Promise<void> {
  const url = `${CALLPRO_URL}?key=${encodeURIComponent(CALLPRO_KEY)}`;
  const res = await axios.post(
    url,
    { key: CALLPRO_KEY, from: CALLPRO_FROM, to: String(to), text: String(text) },
    {
      headers: {
        "x-api-key": CALLPRO_KEY,
        "api-key": CALLPRO_KEY,
        Authorization: `Bearer ${CALLPRO_KEY}`,
        "Content-Type": "application/json",
      },
    }
  );
  const raw = Array.isArray(res.data) ? res.data[0] : res.data;
  const result = String(raw?.Result ?? raw?.result ?? "").toUpperCase();
  if (result === "FAILED" || result === "ERROR") {
    throw new Error(raw?.Message || raw?.message || "CallPro rejected");
  }
}
