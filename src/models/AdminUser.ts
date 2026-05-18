import mongoose, { Schema } from "mongoose";

const AdminUserSchema = new Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: { type: String, required: true },
    displayName: { type: String, required: true, trim: true },
    role: { type: String, default: "admin" }, // superadmin | admin
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", default: null },
    status: { type: String, default: "active" },
    lastLogin: { type: Date },
  },
  { timestamps: true },
);

export type AdminUserDoc = mongoose.InferSchemaType<typeof AdminUserSchema>;
export const AdminUser =
  mongoose.models.AdminUser ?? mongoose.model("AdminUser", AdminUserSchema);
