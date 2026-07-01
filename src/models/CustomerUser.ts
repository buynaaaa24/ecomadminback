import mongoose, { Schema } from "mongoose";

/**
 * Storefront customer (end-user) model — separate from AdminUser.
 * Tenants share a central DB with tenantId isolation OR use their own DB.
 */
const CustomerUserSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", index: true, default: null },

    firstName: { type: String, required: true, trim: true },
    lastName:  { type: String, trim: true, default: "" },

    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    phone: {
      type: String,
      trim: true,
      default: "",
    },

    passwordHash: { type: String, required: true },

    /** Hashed refresh tokens (one per active device/browser). */
    refreshTokens: [{ type: String }],

    status: { type: String, default: "active" }, // active | blocked
    lastLogin: { type: Date },
  },
  { timestamps: true },
);

// Compound index so the same email can exist in different tenants
CustomerUserSchema.index({ tenantId: 1, email: 1 }, { unique: true });

export type CustomerUserDoc = mongoose.InferSchemaType<typeof CustomerUserSchema>;
export const CustomerUser =
  mongoose.models.CustomerUser ??
  mongoose.model("CustomerUser", CustomerUserSchema);
