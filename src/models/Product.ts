import mongoose from "mongoose";
import { productSchema } from "./productSchema.js";

export type ProductDoc = mongoose.InferSchemaType<typeof productSchema>;
export const Product =
  mongoose.models.Product ?? mongoose.model("Product", productSchema);
