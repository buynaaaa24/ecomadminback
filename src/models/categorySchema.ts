import mongoose, { Schema } from "mongoose";

export const categorySchema = new Schema(
  {
    // Only populated when using the shared (central) database
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", index: true },
    name: { type: String, required: true },
    slug: { type: String, required: true },
    parentId: { type: String, default: null },
    image: { type: String, default: "" },
    status: { type: String, default: "active" }, // active | inactive
  },
  { timestamps: true },
);

export function getCategoryModel(conn: mongoose.Connection) {
  return conn.models.Category ?? conn.model("Category", categorySchema);
}
