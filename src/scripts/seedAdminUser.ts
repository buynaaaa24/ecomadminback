import "dotenv/config";
import bcrypt from "bcryptjs";
import { connectMongo } from "../db.js";
import { AdminUser } from "../models/AdminUser.js";

async function main() {
  await connectMongo();
  const existing = await AdminUser.countDocuments();
  if (existing > 0) {
    console.log("AdminUser documents already exist; nothing to seed.");
    return;
  }

  const email = "superadmin@ikhnayd.mn";
  const password = "admin";
  const username = "superadmin";

  const passwordHash = await bcrypt.hash(password, 10);

  await AdminUser.create({
    username,
    email,
    passwordHash,
    displayName: "Super Admin",
    role: "superadmin",
    active: true,
  });

  console.log(`Seeded Super AdminUser: ${email} / ${password}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
