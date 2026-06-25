import axios from "axios";
import { Ebarimt } from "../models/Ebarimt.js";

const EBARIMT_URL = process.env.EBARIMT_URL ?? "http://103.143.40.43:7080";
const EBARIMT_TEST_URL = process.env.EBARIMT_TEST_URL ?? "http://103.236.194.50:7080";

function getDistrictCode(districtName: string): string {
  if (!districtName) return "1200";
  const name = districtName.toLowerCase().trim();
  if (name.includes("сүхбаатар") || name.includes("sukhbaatar")) return "1200";
  if (name.includes("баянзүрх") || name.includes("bayanzurkh")) return "1300";
  if (name.includes("чингэлтэй") || name.includes("chingeltei")) return "1400";
  if (name.includes("баянгол") || name.includes("bayangol")) return "1500";
  if (name.includes("хан-уул") || name.includes("khan-uul") || name.includes("khan uul")) return "1600";
  if (name.includes("сонгинохайрхан") || name.includes("songinokhairkhan")) return "1700";
  if (name.includes("налайх") || name.includes("nalaikh")) return "1800";
  if (name.includes("багануур") || name.includes("baganuur")) return "1900";
  if (name.includes("багахангай") || name.includes("bagakhangai")) return "2000";
  if (/^\d{4}$/.test(districtName)) return districtName;
  return "1200";
}

export async function issueEbarimt(order: any, tenant: any, receiptType: string = "B2C_RECEIPT", customerTin: string = ""): Promise<any> {
  try {
    const merchantTin = tenant.ebarimtTin;
    if (!merchantTin) {
      throw new Error("Ebarimt TIN (ebarimtTin) is not configured for this tenant");
    }

    const districtCode = getDistrictCode(tenant.ebarimtDistrict || "");
    const nuatTulukhEsekh = tenant.ebarimtVat === true;

    // Map order items to ebarimt items
    const items = order.items.map((item: any) => {
      const qty = Number(item.quantity);
      const unitPrice = Number(item.price);
      const totalAmount = unitPrice * qty;

      let totalVAT = 0;
      if (nuatTulukhEsekh) {
        totalVAT = Math.abs(totalAmount / 1.1 / 10);
        totalVAT = Math.round((totalVAT + Number.EPSILON) * 100000) / 100000;
      }

      const itemObj: any = {
        uramshuulaliinBaraaEsekh: false,
        name: item.name,
        barCode: "UNDEFINED",
        barCodeType: "UNDEFINED",
        classificationCode: item.classificationCode || "5020100",
        measureUnit: "шир",
        qty: qty.toFixed(2),
        unitPrice: unitPrice.toFixed(2),
        totalVat: totalVAT,
        totalCityTax: 0,
        totalAmount,
      };
      if (!nuatTulukhEsekh) {
        itemObj.taxProductCode = item.taxProductCode || "5020100";
      }
      return itemObj;
    });

    const totalAmount = items.reduce((sum: number, x: any) => sum + x.totalAmount, 0);
    const totalVAT = items.reduce((sum: number, x: any) => sum + x.totalVat, 0);

    const receipts = [{
      totalAmount: Math.round((totalAmount + Number.EPSILON) * 100) / 100,
      totalVAT: Math.round((totalVAT + Number.EPSILON) * 100000) / 100000,
      totalCityTax: "0.00",
      taxType: nuatTulukhEsekh ? "VAT_ABLE" : "VAT_FREE",
      merchantTin,
      items,
    }];

    const payload: any = {
      type: receiptType,
      baiguullagiinId: merchantTin,
      salbariinId: "001",
      guilgeeniiDugaar: order.orderNumber,
      branchNo: "001",
      districtCode,
      posNo: "0001",
      merchantTin,
      totalAmount: Math.round((totalAmount + Number.EPSILON) * 100) / 100,
      totalVAT: Math.round((totalVAT + Number.EPSILON) * 100000) / 100000,
      totalCityTax: 0,
      customerNo: customerTin || "",
      receipts,
      payments: [{
        code: "CASH",
        paidAmount: Math.round((totalAmount + Number.EPSILON) * 100) / 100,
        status: "PAID",
      }],
    };

    const isTest = tenant.ebarimtTest === true || process.env.NODE_ENV !== "production";
    const baseUrl = (isTest ? EBARIMT_TEST_URL : EBARIMT_URL).replace(/\/$/, "");
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
