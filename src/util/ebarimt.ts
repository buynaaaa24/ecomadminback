import axios from "axios";
import { Ebarimt } from "../models/Ebarimt.js";

const EBARIMT_URL = process.env.EBARIMT_URL ?? "http://103.143.40.43:7080";
const EBARIMT_TEST_URL = process.env.EBARIMT_TEST_URL ?? "http://103.236.194.50:7080";

function getDistrictCode(districtKod: string, khorooKod: string): string {
  const dStr = (districtKod || "").toLowerCase();
  let d = "25";
  if (dStr.includes("сүхбаатар") || dStr.includes("sukhbaatar") || dStr === "25") d = "25";
  else if (dStr.includes("баянзүрх") || dStr.includes("bayanzurkh") || dStr === "26") d = "26";
  else if (dStr.includes("баянгол") || dStr.includes("bayangol") || dStr === "24") d = "24";
  else if (dStr.includes("хан-уул") || dStr.includes("khan-uul") || dStr === "23") d = "23";
  else if (dStr.includes("сонгинохайрхан") || dStr.includes("songinokhairkhan") || dStr === "27") d = "27";
  else if (dStr.includes("чингэлтэй") || dStr.includes("chingeltei") || dStr === "28") d = "28";

  const kNums = (khorooKod || "20").replace(/\D/g, "");
  const k = (kNums || "20").padStart(2, "0");
  return d + k;
}

export async function issueEbarimt(order: any, tenant: any, receiptType: string = "B2C_RECEIPT", customerTin: string = ""): Promise<any> {
  try {
    const merchantTin = tenant.ebarimtTin || "37900846788";

    const isTest = tenant.ebarimtTest === true || process.env.NODE_ENV !== "production";
    const baseUrl = (isTest ? EBARIMT_TEST_URL : EBARIMT_URL).replace(/\/$/, "");

    if (receiptType === "B2B_RECEIPT" && customerTin) {
      const checkUrl = `${baseUrl}/rest/checkInformation`;
      console.log(`[Ebarimt] Checking company register: ${checkUrl} for TIN: ${customerTin}`);
      try {
        const checkRes = await axios.post(checkUrl, { registerNo: customerTin }, {
          headers: { "Content-Type": "application/json" },
          timeout: 5000,
        });
        console.log(`[Ebarimt] checkInformation response:`, JSON.stringify(checkRes.data));
      } catch (err: any) {
        console.error(`[Ebarimt] checkInformation failed for ${customerTin}:`, err.message);
      }
    }

    const districtCode = getDistrictCode(tenant.ebarimtDistrict || "", tenant.ebarimtKhoroo || "20");
    const nuatTulukhEsekh = tenant.ebarimtVat !== false; // Default true

    // Map order items to ebarimt items
    const items = order.items.map((item: any) => {
      const qty = Number(item.quantity) || 1;
      const unitPrice = Number(item.price) || 0;
      const totalAmount = unitPrice * qty;

      let totalVAT = 0;
      if (nuatTulukhEsekh) {
        totalVAT = Math.round((totalAmount / 1.1 / 10 + Number.EPSILON) * 100) / 100;
      }

      const itemObj: any = {
        name: item.name,
        barCode: "",
        barCodeType: "UNDEFINED",
        classificationCode: item.classificationCode || "5020100",
        taxProductCode: "",
        measureUnit: "ш",
        qty: qty,
        unitPrice: unitPrice,
        totalVAT: totalVAT,
        totalCityTax: 0,
        totalAmount: totalAmount,
      };
      return itemObj;
    });

    const totalAmount = items.reduce((sum: number, x: any) => sum + x.totalAmount, 0);
    const totalVAT = items.reduce((sum: number, x: any) => sum + x.totalVAT, 0);

    const receipts = [{
      totalAmount: Math.round((totalAmount + Number.EPSILON) * 100) / 100,
      totalVAT: Math.round((totalVAT + Number.EPSILON) * 100) / 100,
      totalCityTax: 0,
      taxType: nuatTulukhEsekh ? "VAT_ABLE" : "VAT_FREE",
      merchantTin,
      items,
      ...(customerTin ? { customerTin } : {}),
    }];

    const payload: any = {
      type: receiptType || "B2C_RECEIPT",
      branchNo: "000",
      districtCode,
      posNo: "0001",
      merchantTin,
      totalAmount: Math.round((totalAmount + Number.EPSILON) * 100) / 100,
      totalVAT: Math.round((totalVAT + Number.EPSILON) * 100) / 100,
      totalCityTax: 0,
      receipts,
      payments: [{
        code: "PAYMENT_CARD",
        paidAmount: Math.round((totalAmount + Number.EPSILON) * 100) / 100,
        status: "PAID",
      }],
    };

    const requestUrl = `${baseUrl}/rest/receipt`;
    console.log(`[Ebarimt] Issuing receipt: ${requestUrl} (test=${isTest})`, JSON.stringify(payload));

    const response = await axios.post(requestUrl, payload, {
      headers: { "Content-Type": "application/json" },
      timeout: 10000,
    });

    const resData = response.data;
    if (!resData || resData.errorCode || resData.status === "ERROR") {
      throw new Error(resData.message || `Ebarimt failed: code ${resData.errorCode}`);
    }

    console.log(`[Ebarimt] Success! ID: ${resData.id}, Lottery: ${resData.lottery}`);

    const ebarimtDoc = await Ebarimt.create({
      tenantId: tenant._id,
      orderNumber: order.orderNumber,
      billId: resData.id,
      lottery: resData.lottery || "",
      qrData: resData.qrData || "",
      totalAmount,
      totalVAT,
      merchantTin,
      type: receiptType,
      customerTin: customerTin || "",
      rawResponse: resData,
    });

    return ebarimtDoc;
  } catch (error: any) {
    const detail = error?.response?.data ? JSON.stringify(error.response.data) : error.message;
    console.error("[Ebarimt Error]:", detail);
    throw error;
  }
}
