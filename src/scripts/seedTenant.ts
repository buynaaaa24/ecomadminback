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
    name: "ikhNayd Demo Site",
    slug: "demo",
    primaryColor: "#D32F2F",
    font: "Inter",
    layout: "modern",
    features: { reviews: true, chat: false, loyaltyProgram: false },
    status: "active"
  });

  console.log(`Seeded default Demo tenant.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
