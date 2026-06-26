import mongoose, { Schema } from "mongoose";

const BrandSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    name: { type: String, required: true },
    slug: { type: String, required: true },
    logo: { type: String, default: "" },
    description: { type: String, default: "" },
    renterId: { type: String, default: null },
    status: { type: String, default: "active" }, // active | inactive
  },
  { timestamps: true },
);

BrandSchema.index({ tenantId: 1, status: 1, name: 1 });

export type BrandDoc = mongoose.InferSchemaType<typeof BrandSchema>;
export const Brand =
  mongoose.models.Brand ?? mongoose.model("Brand", BrandSchema);
