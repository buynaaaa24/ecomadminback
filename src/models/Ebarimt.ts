import mongoose, { Schema } from "mongoose";

const EbarimtSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", index: true },
    orderNumber: { type: String, required: true, index: true },
    billId: { type: String, required: true }, // DDTD
    lottery: { type: String, default: "" },
    qrData: { type: String, default: "" },
    totalAmount: { type: Number, required: true },
    totalVAT: { type: Number, default: 0 },
    totalCityTax: { type: Number, default: 0 },
    merchantTin: { type: String, default: "" },
    customerTin: { type: String, default: "" },
    type: { type: String, default: "B2C_RECEIPT" }, // B2C_RECEIPT | B2B_RECEIPT
    rawResponse: { type: Schema.Types.Mixed },
  },
  { timestamps: true }
);

export const Ebarimt = mongoose.models.Ebarimt ?? mongoose.model("Ebarimt", EbarimtSchema);
