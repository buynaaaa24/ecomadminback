import "dotenv/config";
import { connectMongo } from "../db.js";
import { Tenant } from "../models/Tenant.js";

async function main() {
  await connectMongo();
  const existing = await Tenant.countDocuments();
  if (existing > 0) {
    console.log("Tenants already exist; nothing to seed.");
    return;
  }

  await Tenant.create({
    name: "Demo Site",
    slug: "demo",
    domain: "",
    databaseUri: "",
    primaryColor: "#D32F2F",
    secondaryColor: "#0f172a",
    accentColor: "#FFC107",
    logo: "",
    font: "Inter",
    layout: "modern",
    description: "эко-систем дэх туршилтын сайт",
    bannerTitle: "Хамгийн шилдэг бараанууд",
    bannerSubtitle: "Хямдрал, шинэ бараа, хүргэлт",
    contactEmail: "info@demo.mn",
    contactPhone: "7700-0000",
    address: "Улаанбаатар хот",
    features: { reviews: true, chat: false, loyaltyProgram: false },
    status: "active",
  });

  console.log("Seeded default Demo tenant.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
