import axios from "axios";
import { Ebarimt } from "../models/Ebarimt.js";

const EBARIMTSHINE_IP = process.env.EBARIMTSHINE_IP ?? "http://103.143.40.43:7080/";
const EBARIMTSHINE_TEST = process.env.EBARIMTSHINE_TEST ?? "http://103.236.194.50:7080/";
const CENTRAL_CONFIG_URL = "http://103.236.194.68:8080";

function getDistrictCode(districtName: string): string {
  if (!districtName) return "12";
  const name = districtName.toLowerCase().trim();
  if (name.includes("сүхбаатар") || name.includes("sukhbaatar")) return "12";
  if (name.includes("баянзүрх") || name.includes("bayanzurkh")) return "13";
  if (name.includes("чингэлтэй") || name.includes("chingeltei")) return "14";
  if (name.includes("баянгол") || name.includes("bayangol")) return "15";
  if (name.includes("хан-уул") || name.includes("khan-uul") || name.includes("khan uul")) return "16";
  if (name.includes("сонгинохайрхан") || name.includes("songinokhairkhan")) return "17";
  if (name.includes("налайх") || name.includes("nalaikh")) return "18";
  if (name.includes("багануур") || name.includes("baganuur")) return "19";
  if (name.includes("багахангай") || name.includes("bagakhangai")) return "20";
  
  if (/^\d{2}$/.test(districtName)) return districtName;
  return "12"; // Default fallback
}

export async function issueEbarimt(order: any, tenant: any): Promise<any> {
  try {
    const orgId = tenant.ebarimtTin || tenant.emOrgId || tenant.posOrgId;
    if (!orgId) {
      throw new Error("Ebarimt configuration error: Ebarimt TIN or Org ID is not configured for this tenant");
    }

    // 1. Fetch branch/org settings from central POS config server
    let baiguullaga: any = null;
    try {
      const configUrl = `${CENTRAL_CONFIG_URL}/emiinSan/${orgId}`;
      console.log(`[Ebarimt Utility] Fetching settings from: ${configUrl}`);
      const res = await axios.get(configUrl, {
        headers: { "Content-Type": "application/json; charset=utf-8" },
        timeout: 5000,
      });
      baiguullaga = res.data;
    } catch (err: any) {
      console.warn("[Ebarimt Utility] POS config fetch failed, using client admin fallback settings:", err.message);
    }

    const configSettings = baiguullaga?.tokhirgoo || {};
    
    // Resolve organization details (favoring admin settings over POS server config)
    const finalTin = tenant.ebarimtTin || configSettings.merchantTin || baiguullaga?.register || orgId;
    const finalDistrictCode = tenant.ebarimtDistrict ? getDistrictCode(tenant.ebarimtDistrict) : (configSettings.districtCode || "12");
    const classificationCode = configSettings.classificationCode || "5311";
    const nuatTulukhEsekh = configSettings.nuatTulukhEsekh !== undefined ? configSettings.nuatTulukhEsekh : false;

    // 2. Map Order items to Ebarimt items
    const items = order.items.map((item: any) => {
      const qty = Number(item.quantity);
      const unitPrice = Number(item.price);
      const totalAmount = unitPrice * qty;

      let totalVAT = 0;
      if (nuatTulukhEsekh) {
        totalVAT = Math.abs(totalAmount / 1.1 / 10);
        totalVAT = Math.round((totalVAT + Number.EPSILON) * 100000) / 100000;
      }

      return {
        uramshuulaliinBaraaEsekh: false,
        name: item.name,
        barCode: "UNDEFINED",
        barCodeType: "UNDEFINED",
        classificationCode: classificationCode,
        measureUnit: "шир",
        qty: qty.toFixed(2),
        unitPrice: unitPrice.toFixed(2),
        totalVat: totalVAT,
        totalCityTax: 0,
        totalAmount: totalAmount,
      };
    });


    const totalAmount = items.reduce((sum: number, x: any) => sum + x.totalAmount, 0);
    const totalVAT = items.reduce((sum: number, x: any) => sum + x.totalVat, 0);

    const receipts = [
      {
        totalAmount: Math.round((totalAmount + Number.EPSILON) * 100) / 100,
        totalVAT: Math.round((totalVAT + Number.EPSILON) * 100000) / 100000,
        totalCityTax: "0.00",
        taxType: nuatTulukhEsekh ? "VAT_ABLE" : "VAT_FREE",
        merchantTin: finalTin,
        items,
      }
    ];

    const payload: any = {
      type: "B2C_RECEIPT",
      baiguullagiinId: orgId,
      salbariinId: tenant.emBranchId || tenant.posBranchId || "001",
      guilgeeniiDugaar: order.orderNumber,
      branchNo: "001",
      districtCode: finalDistrictCode,
      posNo: "0001",
      merchantTin: finalTin,
      totalAmount: Math.round((totalAmount + Number.EPSILON) * 100) / 100,
      totalVAT: Math.round((totalVAT + Number.EPSILON) * 100000) / 100000,
      totalCityTax: 0,
      customerNo: "",
      receipts,
      payments: [
        {
          code: "CASH",
          paidAmount: Math.round((totalAmount + Number.EPSILON) * 100) / 100,
          status: "PAID",
        }
      ]
    };

    // 3. Post receipt to tax service daemon
    const isTest = (
      orgId === "652e52e91ff333127f361a15" ||
      tenant._id === "6a0b3775e2ba63567e569c6c" ||
      String(tenant._id) === "6a0b3775e2ba63567e569c6c"
    );
    const ebarimtBase = (isTest ? EBARIMTSHINE_TEST : EBARIMTSHINE_IP).replace(/\/$/, "");
    const requestUrl = `${ebarimtBase}/rest/receipt`;
    console.log(`[Ebarimt Utility] Issuing receipt via: ${requestUrl} (isTest=${isTest})`);

    const response = await axios.post(requestUrl, payload, {
      headers: { "Content-Type": "application/json" },
    });

    const resData = response.data;
    if (!resData || resData.errorCode || resData.status === "ERROR") {
      throw new Error(resData.message || `Ebarimt registration failed with code: ${resData.errorCode}`);
    }

    console.log(`[Ebarimt Utility] Success! Receipt ID: ${resData.id}, Lottery: ${resData.lottery}`);

    // 4. Save Ebarimt record in DB
    const ebarimtDoc = await Ebarimt.create({
      tenantId: tenant._id,
      orderNumber: order.orderNumber,
      billId: resData.id,
      lottery: resData.lottery || "",
      qrData: resData.qrData || "",
      totalAmount: totalAmount,
      totalVAT: totalVAT,
      merchantTin: finalTin,
      type: "B2C_RECEIPT",
      rawResponse: resData,
    });

    return ebarimtDoc;
  } catch (error: any) {
    console.error("[Ebarimt Utility Error]:", error.message || error);
    throw error;
  }
}
