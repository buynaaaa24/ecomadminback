import mongoose, { Schema } from "mongoose";

/**
 * Shared order schema definition — used both by the central Order model and by
 * per-tenant connection models created via getOrderModel().
 */
export const orderSchema = new Schema(
  {
    // Populated when using the shared (central) database
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", index: true },
    customerInfo: {
      lastName: { type: String, default: "" },
      firstName: { type: String, required: true },
      phone: { type: String, required: true },
      email: { type: String, default: "" },
      address: { type: String, required: true },
    },
    items: [
      {
        productId: { type: String, required: true },
        name: { type: String, required: true },
        quantity: { type: Number, required: true, min: 1 },
        price: { type: Number, required: true },
        ebarimtBillId: { type: String, default: "" },
        ebarimtLottery: { type: String, default: "" },
        ebarimtQrData: { type: String, default: "" },
      },
    ],
    total: { type: Number, required: true },
    shippingFee: { type: Number, default: 0 },
    paymentMethod: { type: String, required: true },
    paymentStatus: { type: String, default: "pending" }, // pending | paid | refunded
    orderStatus: { type: String, default: "pending" }, // pending | processing | delivered | cancelled
    orderNumber: { type: String, required: true, index: true },
  },
  { timestamps: true },
);

orderSchema.index({ tenantId: 1, createdAt: -1 });

/**
 * Returns the Order model bound to a specific mongoose.Connection.
 */
export function getOrderModel(conn: mongoose.Connection) {
  return conn.models.Order ?? conn.model("Order", orderSchema);
}
