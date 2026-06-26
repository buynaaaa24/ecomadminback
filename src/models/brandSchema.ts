import mongoose, { Schema } from "mongoose";

export const brandSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", index: true },
    name: { type: String, required: true },
    slug: { type: String, required: true },
    logo: { type: String, default: "" },
    description: { type: String, default: "" },
    renterId: { type: String, default: null },
    status: { type: String, default: "active" }, // active | inactive
  },
  { timestamps: true },
);

brandSchema.index({ tenantId: 1, status: 1, name: 1 });

export function getBrandModel(conn: mongoose.Connection) {
  return conn.models.Brand ?? conn.model("Brand", brandSchema);
}
