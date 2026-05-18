import "dotenv/config";
import bcrypt from "bcryptjs";
import { connectMongo } from "../db.js";
import { AdminUser } from "../models/AdminUser.js";

async function main() {
  await connectMongo();
  // Seed legacy superadmin@gmail.mn / admin
  const legacyEmail = "superadmin@gmail.mn";
  const legacyExists = await AdminUser.findOne({ email: legacyEmail });
  if (!legacyExists) {
    const passwordHash = await bcrypt.hash("admin", 10);
    await AdminUser.create({
      username: "superadmin",
      email: legacyEmail,
      passwordHash,
      displayName: "Super Admin",
      role: "superadmin",
      active: true,
    });
    console.log(`Seeded Super AdminUser: ${legacyEmail} / admin`);
  }

  // Seed admin@gmail.mn / admin123
  const newEmail = "admin@gmail.mn";
  const newExists = await AdminUser.findOne({ email: newEmail });
  if (!newExists) {
    const passwordHash = await bcrypt.hash("admin123", 10);
    await AdminUser.create({
      username: "admin",
      email: newEmail,
      passwordHash,
      displayName: "Super Administrator",
      role: "superadmin",
      active: true,
    });
    console.log(`Seeded Super AdminUser: ${newEmail} / admin123`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
