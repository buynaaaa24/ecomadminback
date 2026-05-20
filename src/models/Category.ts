import mongoose, { Schema } from "mongoose";

const CategorySchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    name: { type: String, required: true },
    slug: { type: String, required: true },
    parentId: { type: String, default: null },
    image: { type: String, default: "" },
    status: { type: String, default: "active" }, // active | inactive
  },
  { timestamps: true },
);

export type CategoryDoc = mongoose.InferSchemaType<typeof CategorySchema>;
export const Category =
  mongoose.models.Category ?? mongoose.model("Category", CategorySchema);
