import "dotenv/config";
import { connectMongo } from "../db.js";
import { Tenant } from "../models/Tenant.js";
import { Category } from "../models/Category.js";

// Subcategories to create under each root slug
const SUBCATEGORY_MAP: Record<string, { name: string; slug: string; image: string }[]> = {
  "ажлын-өрөөний-тавилга": [
    { name: "Ажлын ширээ",           slug: "ажлын-ширээ",           image: "https://images.unsplash.com/photo-1518455027359-f3f8164ba6bd?w=400&h=400&fit=crop" },
    { name: "Ажлын сандал",          slug: "ажлын-сандал",          image: "https://images.unsplash.com/photo-1592078615290-033ee584e267?w=400&h=400&fit=crop" },
    { name: "Шкаф & Тавиур",         slug: "шкаф-тавиур",           image: "https://images.unsplash.com/photo-1595428774223-ef52624120d2?w=400&h=400&fit=crop" },
    { name: "Хурлын өрөөний тавилга",slug: "хурлын-өрөөний-тавилга",image: "https://images.unsplash.com/photo-1497366216548-37526070297c?w=400&h=400&fit=crop" },
  ],

  "ариун-цэврийн-өрөөний-тавилга": [
    { name: "Угаалтуурын тавилга", slug: "угаалтуурын-тавилга", image: "https://images.unsplash.com/photo-1552321554-5fefe8c9ef14?w=400&h=400&fit=crop" },
    { name: "Банны шкаф",         slug: "банны-шкаф",         image: "https://images.unsplash.com/photo-1584622650111-993a426fbf0a?w=400&h=400&fit=crop" },
    { name: "Толийн тавилга",     slug: "толийн-тавилга",     image: "https://images.unsplash.com/photo-1567538096621-38d2284b23ff?w=400&h=400&fit=crop" },
  ],

  "буйдан": [
    { name: "L-хэлбэрийн буйдан",  slug: "l-хэлбэрийн-буйдан",  image: "https://images.unsplash.com/photo-1493663284031-b7e3aefcae8e?w=400&h=400&fit=crop" },
    { name: "2-3 суудалтай буйдан", slug: "2-3-суудалтай-буйдан", image: "https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=400&h=400&fit=crop" },
    { name: "Фотель",               slug: "фотель",               image: "https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=400&h=400&fit=crop" },
    { name: "Угсрах буйдан",        slug: "угсрах-буйдан",        image: "https://images.unsplash.com/photo-1540574163026-643ea20ade25?w=400&h=400&fit=crop" },
  ],

  "гал-тогоо-хоолны-өрөө": [
    { name: "Гал тогооны шүүгээ",     slug: "гал-тогооны-шүүгээ",     image: "https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=400&h=400&fit=crop" },
    { name: "Хоолны ширээ & сандал",  slug: "хоолны-ширээ-сандал",    image: "https://images.unsplash.com/photo-1617806118233-18e1de247200?w=400&h=400&fit=crop" },
    { name: "Бар сандал",             slug: "бар-сандал",              image: "https://images.unsplash.com/photo-1611269154421-4e27233ac5c5?w=400&h=400&fit=crop" },
  ],

  "гэр-ахуйн-чимэглэл": [
    { name: "Ханын чимэглэл", slug: "ханын-чимэглэл", image: "https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=400&h=400&fit=crop" },
    { name: "Хивс & Дэвсгэр", slug: "хивс-дэвсгэр",  image: "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=400&h=400&fit=crop" },
    { name: "Толь",            slug: "толь",           image: "https://images.unsplash.com/photo-1567538096621-38d2284b23ff?w=400&h=400&fit=crop" },
    { name: "Вазон & Цэцэг",  slug: "вазон-цэцэг",   image: "https://images.unsplash.com/photo-1487530811015-780780169de5?w=400&h=400&fit=crop" },
  ],

  "гэрэл-гэрэлтүүлэг": [
    { name: "Дагзан дэнлүү",  slug: "дагзан-дэнлүү",  image: "https://images.unsplash.com/photo-1524484485831-a92ffc0de03f?w=400&h=400&fit=crop" },
    { name: "Шалны дэнлүү",   slug: "шалны-дэнлүү",   image: "https://images.unsplash.com/photo-1507473885765-e6ed057f782c?w=400&h=400&fit=crop" },
    { name: "Ширээний дэнлүү",slug: "ширээний-дэнлүү", image: "https://images.unsplash.com/photo-1513506003901-1e6a35f6ec7b?w=400&h=400&fit=crop" },
    { name: "Ханын дэнлүү",   slug: "ханын-дэнлүү",   image: "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=400&h=400&fit=crop" },
  ],

  "зочны-өрөөний-тавилга": [
    { name: "Кофе ширээ",   slug: "кофе-ширээ",   image: "https://images.unsplash.com/photo-1549187774-b4e9b0445b41?w=400&h=400&fit=crop" },
    { name: "ТВ тавиур",    slug: "тв-тавиур",    image: "https://images.unsplash.com/photo-1593784991095-a205069470b6?w=400&h=400&fit=crop" },
    { name: "Тавиур",       slug: "тавиур",       image: "https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=400&h=400&fit=crop" },
  ],

  "тагт-гадна-талбай": [
    { name: "Гадна ширээ & сандал", slug: "гадна-ширээ-сандал", image: "https://images.unsplash.com/photo-1600210492493-0946911123ea?w=400&h=400&fit=crop" },
    { name: "Гадна буйдан",         slug: "гадна-буйдан",        image: "https://images.unsplash.com/photo-1600566752355-35792bedcfea?w=400&h=400&fit=crop" },
    { name: "Гадна чимэглэл",       slug: "гадна-чимэглэл",      image: "https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=400&h=400&fit=crop" },
  ],

  "унтлагын-өрөөний-тавилга": [
    { name: "Ор & Матрас",           slug: "ор-матрас",            image: "https://images.unsplash.com/photo-1616594039964-ae9021a400a0?w=400&h=400&fit=crop" },
    { name: "Шүүгээ",                slug: "шүүгээ",               image: "https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=400&h=400&fit=crop" },
    { name: "Орны хажуугийн тавиур", slug: "орны-хажуугийн-тавиур",image: "https://images.unsplash.com/photo-1551298370-9d3d53740c72?w=400&h=400&fit=crop" },
    { name: "Бүүр",                  slug: "бүүр",                 image: "https://images.unsplash.com/photo-1540518614846-7eded433c457?w=400&h=400&fit=crop" },
  ],

  "хүүхдийн-өрөөний-тавилга": [
    { name: "Хүүхдийн ор",          slug: "хүүхдийн-ор",          image: "https://images.unsplash.com/photo-1555252333-9f8e92e65df9?w=400&h=400&fit=crop" },
    { name: "Хүүхдийн ширээ & сандал",slug:"хүүхдийн-ширээ-сандал",image: "https://images.unsplash.com/photo-1503919545889-aef636e10ad4?w=400&h=400&fit=crop" },
    { name: "Хүүхдийн шүүгээ",      slug: "хүүхдийн-шүүгээ",      image: "https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=400&h=400&fit=crop" },
    { name: "Тоглоомын тавиур",      slug: "тоглоомын-тавиур",      image: "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=400&h=400&fit=crop" },
  ],

  "цахилгаан-бараа": [
    { name: "Телевизор",    slug: "телевизор",    image: "https://images.unsplash.com/photo-1593642632559-0c6d3fc62b89?w=400&h=400&fit=crop" },
    { name: "Гэрийн аппарат",slug:"гэрийн-аппарат",image:"https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=400&h=400&fit=crop"},
    { name: "Аудио систем", slug: "аудио-систем", image: "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=400&h=400&fit=crop" },
  ],

  "үүдний-танхимын-тавилга": [
    { name: "Гутлын тавиур",  slug: "гутлын-тавиур",  image: "https://images.unsplash.com/photo-1595428774223-ef52624120d2?w=400&h=400&fit=crop" },
    { name: "Пальтоны өлгүүр",slug: "пальтоны-өлгүүр",image: "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=400&h=400&fit=crop" },
    { name: "Үүдний суудал",  slug: "үүдний-суудал",  image: "https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=400&h=400&fit=crop" },
  ],
};

async function main() {
  await connectMongo();

  const tenant = await Tenant.findOne({ slug: "go-to-market" });
  if (!tenant) {
    console.error('Tenant "go-to-market" not found.');
    process.exit(1);
  }

  const tid = tenant._id;
  console.log(`Tenant: ${tenant.name} (${tid})\n`);

  let totalCreated = 0;
  let totalSkipped = 0;

  for (const [rootSlug, children] of Object.entries(SUBCATEGORY_MAP)) {
    // Find the root category
    const root = await Category.findOne({ tenantId: tid, slug: rootSlug });
    if (!root) {
      console.warn(`  ⚠ Root category not found: ${rootSlug} — skipping`);
      continue;
    }

    const rootId = String(root._id);
    console.log(`📁 ${root.name}`);

    for (const child of children) {
      // Check if already exists (idempotent)
      const exists = await Category.findOne({ tenantId: tid, slug: child.slug });
      if (exists) {
        console.log(`   ↳ skip: ${child.name} (already exists)`);
        totalSkipped++;
        continue;
      }

      await Category.create({
        tenantId: tid,
        name:     child.name,
        slug:     child.slug,
        parentId: rootId,
        image:    child.image,
        banner:   child.image,
        status:   "active",
      });

      console.log(`   ↳ ✅ created: ${child.name}`);
      totalCreated++;
    }
  }

  console.log(`\nDone — ${totalCreated} subcategories created, ${totalSkipped} skipped.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
