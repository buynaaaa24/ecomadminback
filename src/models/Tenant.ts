import mongoose, { Schema } from "mongoose";

const TenantSchema = new Schema(
  {
    // ── Identity ────────────────────────────────────────────────────────────────
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true, index: true },

    /** Custom domain for this tenant's storefront, e.g. "boldstore.mn" */
    domain: { type: String, default: "", trim: true },

    /**
     * MongoDB connection URI for this tenant's dedicated database.
     * If empty, the central database is used with tenantId-based row isolation.
     * Examples:
     *   Same server, different DB: mongodb://127.0.0.1:27017/tenant_bold
     *   Remote server:             mongodb+srv://user:pass@cluster.mongodb.net/tenant_bold
     */
    databaseUri: { type: String, default: "" },

    // ── Branding / Theme ────────────────────────────────────────────────────────
    primaryColor: { type: String, default: "#D32F2F" },
    secondaryColor: { type: String, default: "#0f172a" },
    accentColor: { type: String, default: "#FFC107" },
    logo: { type: String, default: "" },
    font: { type: String, default: "Inter" },
    layout: { type: String, default: "modern" }, // modern | minimal | bold

    // ── Store info ──────────────────────────────────────────────────────────────
    description: { type: String, default: "" },
    bannerTitle: { type: String, default: "" },
    bannerSubtitle: { type: String, default: "" },
    contactEmail: { type: String, default: "" },
    contactPhone: { type: String, default: "" },
    address: { type: String, default: "" },

    // ── Feature flags ───────────────────────────────────────────────────────────
    features: {
      reviews: { type: Boolean, default: false },
      chat: { type: Boolean, default: false },
      loyaltyProgram: { type: Boolean, default: false },
    },

    status: { type: String, default: "active" }, // active | inactive
  },
  { timestamps: true },
);

// Allow efficient domain-based lookup
TenantSchema.index({ domain: 1 }, { sparse: true });

export type TenantDoc = mongoose.InferSchemaType<typeof TenantSchema>;
export const Tenant =
  mongoose.models.Tenant ?? mongoose.model("Tenant", TenantSchema);
