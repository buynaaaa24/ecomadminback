import mongoose from "mongoose";
import { orderSchema } from "./orderSchema.js";

export type OrderDoc = mongoose.InferSchemaType<typeof orderSchema>;
export const Order =
  mongoose.models.Order ?? mongoose.model("Order", orderSchema);
