import mongoose, { Schema } from "mongoose";

/**
 * Shared schema definition — used both by the central Product model and by
 * per-tenant connection models created via getProductModel().
 */
export const productSchema = new Schema(
  {
    // Only populated when using the shared (central) database
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", index: true },
    name: { type: String, required: true },
    description: { type: String, default: "" },
    price: { type: Number, required: true },
    salePrice: { type: Number, default: null },
    stock: { type: Number, default: 0 },
    images: [{ type: String }],
    categoryId: { type: String, default: "" },
    brandId: { type: String, default: "" },
    boothOwnerId: { type: String, default: "" },
    renterId: { type: String, default: null },
    tags: [{ type: String }],
    specifications: { type: Map, of: String },
    featured: { type: Boolean, default: false },
    status: { type: String, default: "active" }, // active | inactive | draft
    slug: { type: String, default: "" },
    isPosLinked: { type: Boolean, default: false },
    posProductCode: { type: String, default: "" },
    isEmLinked: { type: Boolean, default: false },
    emProductCode: { type: String, default: "" },
  },
  { timestamps: true },
);

productSchema.index({ tenantId: 1, status: 1, createdAt: -1 });
productSchema.index({ tenantId: 1, slug: 1 });
productSchema.index({ tenantId: 1, categoryId: 1, status: 1, createdAt: -1 });

/**
 * Returns the Product model bound to a specific mongoose.Connection.
 * Mongoose caches models per connection, so this is safe to call repeatedly.
 */
export function getProductModel(conn: mongoose.Connection) {
  return conn.models.Product ?? conn.model("Product", productSchema);
}
