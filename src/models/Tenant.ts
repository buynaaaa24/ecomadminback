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

    // ── Promo block (MegaMenu right sidebar) ───────────────────────────────────
    promoVisible: { type: Boolean, default: true },
    promoLabel: { type: String, default: "Хязгаартай" },
    promoDiscount: { type: String, default: "30% OFF" },
    promoSubtitle: { type: String, default: "" },
    promoHref: { type: String, default: "/" },

    // ── Branch locations ────────────────────────────────────────────────────────
    locations: [
      {
        name:     { type: String, default: "" },
        district: { type: String, default: "" },
        address:  { type: String, default: "" },
        phone:    { type: String, default: "" },
        hours:    { type: String, default: "" },
      },
    ],

    // ── Homepage config ──────────────────────────────────────────────────────────
    /** Array of { href, title, subtitle, emoji, image } — big (left) carousel slides */
    bannerSlidesBig:   { type: Schema.Types.Mixed, default: [] },
    /** Array of { href, title, subtitle, emoji, image } — small (right) carousel slides */
    bannerSlidesSmall: { type: Schema.Types.Mixed, default: [] },
    /** Array of 9 × { label, sub, href, image } — GroceryBento tiles */
    bentoTiles:        { type: Schema.Types.Mixed, default: [] },
    /** Custom heading for the GroceryBento section */
    bentoTitle:        { type: String, default: "" },
    /** Control layout of the bento slot: category | banner | hide */
    bentoType:         { type: String, default: "category" },
    bentoBannerImage:  { type: String, default: "" },
    bentoBannerLink:   { type: String, default: "" },
    homepageLayout:    { type: Schema.Types.Mixed, default: [] },

    // ── Feature flags ───────────────────────────────────────────────────────────
    features: {
      reviews: { type: Boolean, default: false },
      chat: { type: Boolean, default: false },
      loyaltyProgram: { type: Boolean, default: false },
    },

    // ── POS Integration ──────────────────────────────────────────────────────────
    posDbUri: { type: String, default: "" },
    posBranchId: { type: String, default: "" },
    posOrgId: { type: String, default: "" },

    // ── EM Integration ───────────────────────────────────────────────────────────
    emDbUri: { type: String, default: "" },
    emBranchId: { type: String, default: "" },
    emOrgId: { type: String, default: "" },

    // ── QPay Payment Gateway ──────────────────────────────────────────────────────
    // Global defaults (QPAY_MERCHANT_SERVER / QPAY_USERNAME / QPAY_PASSWORD) live in .env.
    // Per-tenant values override the global credentials when set:
    qpayUsername:         { type: String, default: "" },
    qpayPassword:         { type: String, default: "" },
    qpayTerminalId:       { type: String, default: "" },
    qpayInvoiceCode:      { type: String, default: "" }, // invoice code from QPay portal
    qpayFeeType:          { type: String, enum: ["CHARGE_PAYER", "CHARGE_MERCHANT"], default: "CHARGE_PAYER" }, // required
    // Merchant identity
    qpayMerchantId:       { type: String, default: "" }, // assigned by QPay after registration
    qpayMerchantName:     { type: String, default: "" },
    qpayRegister:         { type: String, default: "" },
    qpayPhone:            { type: String, default: "" },
    qpayEmail:            { type: String, default: "" },
    qpayAddress:          { type: String, default: "" },
    qpayCity:             { type: String, default: "" },
    qpayDistrict:         { type: String, default: "" },
    qpayMccCode:          { type: String, default: "" },
    // Bank account
    qpayBankName:         { type: String, default: "" },
    qpayBankAccount:      { type: String, default: "" },
    qpayBankAccountName:  { type: String, default: "" },

    register: { type: String, default: "" },
    registerTurul: { type: String, enum: ["Байгууллага", "Хувь хүн"], default: "Байгууллага" },

    // ── Shipping/Delivery Configuration ─────────────────────────────────────────
    shippingFee:           { type: Number, default: 15000 },
    shippingFreeThreshold: { type: Number, default: 500000 },

    // ── Ebarimt Client Admin Configuration ──────────────────────────────────────
    ebarimtTin:      { type: String, default: "" },
    ebarimtDistrict: { type: String, default: "" },
    ebarimtKhoroo:   { type: String, default: "" },
    ebarimtEnabled:  { type: Boolean, default: false },
    ebarimtAutoSend: { type: Boolean, default: false },

    branches: [
      {
        id:          { type: String, default: "" },
        name:        { type: String, default: "" },
        register:    { type: String, default: "" },
        systemTurul: { type: String, default: "" },
        systemuud:   [{ type: String }],
        isEnabled:   { type: Boolean, default: true },
      }
    ],

    status: { type: String, default: "active" }, // active | inactive
  },
  { timestamps: true },
);

// Allow efficient domain-based lookup
TenantSchema.index({ domain: 1 }, { sparse: true });

export type TenantDoc = mongoose.InferSchemaType<typeof TenantSchema>;
export const Tenant =
  mongoose.models.Tenant ?? mongoose.model("Tenant", TenantSchema);
