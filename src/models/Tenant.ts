import mongoose, { Schema } from "mongoose";

const TenantSchema = new Schema(
  {
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true, index: true },
    primaryColor: { type: String, default: "#D32F2F" },
    logo: { type: String, default: "" },
    font: { type: String, default: "Inter" },
    layout: { type: String, default: "modern" },
    features: {
      reviews: { type: Boolean, default: false },
      chat: { type: Boolean, default: false },
      loyaltyProgram: { type: Boolean, default: false },
    },
    status: { type: String, default: "active" }, // active | inactive
  },
  { timestamps: true },
);

export type TenantDoc = mongoose.InferSchemaType<typeof TenantSchema>;
export const Tenant =
  mongoose.models.Tenant ?? mongoose.model("Tenant", TenantSchema);
