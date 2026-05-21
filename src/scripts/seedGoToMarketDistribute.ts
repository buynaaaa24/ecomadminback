/**
 * Distributes existing products from root categories into their subcategories.
 * Run AFTER seedGoToMarketSubcats.ts has created the subcategories.
 *
 * For each root category that has subcategories:
 *   - Finds all products currently assigned to the root categoryId
 *   - Splits them roughly evenly across the subcategories (round-robin)
 *   - Updates each product's categoryId to the chosen subcategory's _id
 *
 * Safe to re-run: products already assigned to a sub-category are left alone.
 */

import "dotenv/config";
import { connectMongo } from "../db.js";
import { Tenant } from "../models/Tenant.js";
import { Category } from "../models/Category.js";
import { Product } from "../models/Product.js";
import mongoose from "mongoose";

async function main() {
  await connectMongo();

  const tenant = await Tenant.findOne({ slug: "go-to-market" });
  if (!tenant) {
    console.error('Tenant "go-to-market" not found.');
    process.exit(1);
  }

  const tid = tenant._id;
  console.log(`Tenant: ${tenant.name} (${tid})\n`);

  // Load all categories for this tenant
  const allCats = await Category.find({ tenantId: tid }).lean();

  const rootCats   = allCats.filter((c) => !c.parentId || c.parentId === "null");
  const subCatMap  = new Map<string, typeof allCats>();   // rootId → children

  for (const cat of allCats) {
    if (cat.parentId && cat.parentId !== "null") {
      const arr = subCatMap.get(cat.parentId) ?? [];
      arr.push(cat);
      subCatMap.set(cat.parentId, arr);
    }
  }

  let totalMoved = 0;
  let totalSkipped = 0;

  for (const root of rootCats) {
    const rootId  = String(root._id);
    const subCats = subCatMap.get(rootId) ?? [];

    if (subCats.length === 0) {
      console.log(`📁 ${root.name} — no subcategories, skipping`);
      continue;
    }

    // Find products still assigned to the root category
    const rootProducts = await Product.find({
      tenantId: tid,
      categoryId: rootId,
    }).lean();

    if (rootProducts.length === 0) {
      console.log(`📁 ${root.name} — no root-level products (already distributed?)`);
      totalSkipped++;
      continue;
    }

    console.log(`📁 ${root.name} — ${rootProducts.length} products → ${subCats.length} subcategories`);

    // Round-robin distribute
    for (let i = 0; i < rootProducts.length; i++) {
      const product  = rootProducts[i];
      const targetSub = subCats[i % subCats.length];
      const targetId  = String(targetSub._id);

      await Product.updateOne(
        { _id: product._id },
        { $set: { categoryId: targetId } },
      );

      console.log(`   ↳ "${product.name}" → ${targetSub.name}`);
      totalMoved++;
    }
  }

  console.log(`\nDone — ${totalMoved} products moved to subcategories, ${totalSkipped} root categories skipped.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
