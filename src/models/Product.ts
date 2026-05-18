import mongoose, { Schema } from "mongoose";

const ProductSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    name: { type: String, required: true },
    description: { type: String },
    price: { type: Number, required: true },
    images: [{ type: String }],
    categoryId: { type: String },
    brandId: { type: String },
    boothOwnerId: { type: String },
    tags: [{ type: String }],
    specifications: { type: Map, of: String },
  },
  { timestamps: true },
);

export type ProductDoc = mongoose.InferSchemaType<typeof ProductSchema>;
export const Product =
  mongoose.models.Product ?? mongoose.model("Product", ProductSchema);
