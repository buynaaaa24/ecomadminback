import "dotenv/config";
import { connectMongo } from "../db.js";
import { Tenant } from "../models/Tenant.js";
import { Category } from "../models/Category.js";
import { Product } from "../models/Product.js";

async function main() {
  await connectMongo();

  // ── Find the go-to-market tenant ─────────────────────────────────────────
  const tenant = await Tenant.findOne({ slug: "go-to-market" });
  if (!tenant) {
    console.error('Tenant "go-to-market" not found. Create the tenant first.');
    process.exit(1);
  }

  const tid = tenant._id;
  console.log(`Found tenant: ${tenant.name} (${tid})`);

  // ── Clear existing categories + products for this tenant ─────────────────
  const existingCats = await Category.countDocuments({ tenantId: tid });
  const existingProds = await Product.countDocuments({ tenantId: tid });
  if (existingCats > 0 || existingProds > 0) {
    console.log(`Tenant already has ${existingCats} categories and ${existingProds} products. Skipping seed.`);
    console.log('To re-seed, delete existing data first.');
    return;
  }

  // ── Root categories ───────────────────────────────────────────────────────
  const [catTavil, catDecor] = await Category.insertMany([
    {
      tenantId: tid,
      name: "Тавилга",
      slug: "тавилга",
      parentId: null,
      image: "https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=400&h=400&fit=crop",
      banner: "https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=1400&h=400&fit=crop",
      status: "active",
    },
    {
      tenantId: tid,
      name: "Гэрийн тохижилт",
      slug: "гэрийн-тохижилт",
      parentId: null,
      image: "https://images.unsplash.com/photo-1616486338812-3dadae4b4ace?w=400&h=400&fit=crop",
      banner: "https://images.unsplash.com/photo-1616486338812-3dadae4b4ace?w=1400&h=400&fit=crop",
      status: "active",
    },
  ]);

  // ── Sub-categories under Тавилга ──────────────────────────────────────────
  const [catOffice, catSofa, catBedroom, catKitchen, catLiving] = await Category.insertMany([
    {
      tenantId: tid,
      name: "Ажлын өрөөний тавилга",
      slug: "ажлын-өрөөний-тавилга",
      parentId: String(catTavil._id),
      image: "https://images.unsplash.com/photo-1593642632559-0c6d3fc62b89?w=400&h=400&fit=crop",
      banner: "https://images.unsplash.com/photo-1593642632559-0c6d3fc62b89?w=1400&h=400&fit=crop",
      status: "active",
    },
    {
      tenantId: tid,
      name: "Буйдан",
      slug: "буйдан",
      parentId: String(catTavil._id),
      image: "https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=400&h=400&fit=crop",
      banner: "https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=1400&h=400&fit=crop",
      status: "active",
    },
    {
      tenantId: tid,
      name: "Унтлагын өрөөний тавилга",
      slug: "унтлагын-өрөөний-тавилга",
      parentId: String(catTavil._id),
      image: "https://images.unsplash.com/photo-1616594039964-ae9021a400a0?w=400&h=400&fit=crop",
      banner: "https://images.unsplash.com/photo-1616594039964-ae9021a400a0?w=1400&h=400&fit=crop",
      status: "active",
    },
    {
      tenantId: tid,
      name: "Гал тогооны тавилга",
      slug: "гал-тогооны-тавилга",
      parentId: String(catTavil._id),
      image: "https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=400&h=400&fit=crop",
      banner: "https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=1400&h=400&fit=crop",
      status: "active",
    },
    {
      tenantId: tid,
      name: "Зочны өрөөний тавилга",
      slug: "зочны-өрөөний-тавилга",
      parentId: String(catTavil._id),
      image: "https://images.unsplash.com/photo-1540932239986-30128078f3c5?w=400&h=400&fit=crop",
      banner: "https://images.unsplash.com/photo-1540932239986-30128078f3c5?w=1400&h=400&fit=crop",
      status: "active",
    },
  ]);

  // ── Sub-categories under Гэрийн тохижилт ──────────────────────────────────
  const [catLighting, catDecorSub] = await Category.insertMany([
    {
      tenantId: tid,
      name: "Гэрэлтүүлэг",
      slug: "гэрэлтүүлэг",
      parentId: String(catDecor._id),
      image: "https://images.unsplash.com/photo-1524484485831-a92ffc0de03f?w=400&h=400&fit=crop",
      banner: "https://images.unsplash.com/photo-1524484485831-a92ffc0de03f?w=1400&h=400&fit=crop",
      status: "active",
    },
    {
      tenantId: tid,
      name: "Чимэглэл",
      slug: "чимэглэл",
      parentId: String(catDecor._id),
      image: "https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=400&h=400&fit=crop",
      banner: "https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=1400&h=400&fit=crop",
      status: "active",
    },
  ]);

  const officeId   = String(catOffice._id);
  const sofaId     = String(catSofa._id);
  const bedroomId  = String(catBedroom._id);
  const kitchenId  = String(catKitchen._id);
  const livingId   = String(catLiving._id);
  const lightingId = String(catLighting._id);
  const decorSubId = String(catDecorSub._id);

  // ── Products ──────────────────────────────────────────────────────────────
  await Product.insertMany([
    // ── Office furniture ────────────────────────────────────────────────────
    {
      tenantId: tid, categoryId: officeId, brandId: "",
      name: "Эргэдэг ажлын сандал", slug: "эргэдэг-ажлын-сандал",
      description: "Эргономик дизайнтай, тохирох өндөртэй ажлын сандал. Нурууны дэм сайтай.",
      price: 480000, salePrice: 390000, stock: 15, featured: true, status: "active",
      images: ["https://images.unsplash.com/photo-1592078615290-033ee584e267?w=600&h=600&fit=crop"],
      tags: ["сандал", "оффис", "эргономик"],
    },
    {
      tenantId: tid, categoryId: officeId, brandId: "",
      name: "Ажлын ширээ L-хэлбэрийн", slug: "ажлын-ширээ-l-хэлбэрийн",
      description: "Орон зай хэмнэсэн L-хэлбэрийн ажлын ширээ. 160×120 см. Меламин хучлагатай.",
      price: 890000, salePrice: null, stock: 8, featured: false, status: "active",
      images: ["https://images.unsplash.com/photo-1593642632559-0c6d3fc62b89?w=600&h=600&fit=crop"],
      tags: ["ширээ", "оффис"],
    },
    {
      tenantId: tid, categoryId: officeId, brandId: "",
      name: "Ажлын ширээ цагаан", slug: "ажлын-ширээ-цагаан",
      description: "Цэвэрхэн цагаан өнгийн ажлын ширээ. 120×60 см. Дотор хайрцагтай.",
      price: 560000, salePrice: 490000, stock: 12, featured: true, status: "active",
      images: ["https://images.unsplash.com/photo-1518455027359-f3f8164ba6bd?w=600&h=600&fit=crop"],
      tags: ["ширээ", "оффис", "цагаан"],
    },
    {
      tenantId: tid, categoryId: officeId, brandId: "",
      name: "Файл шкаф 3 таваг", slug: "файл-шкаф-3-таваг",
      description: "Баримт бичиг хадгалах металл шкаф. 3 давхар таваг, цоож хаалгатай.",
      price: 320000, salePrice: null, stock: 20, featured: false, status: "active",
      images: ["https://images.unsplash.com/photo-1595428774223-ef52624120d2?w=600&h=600&fit=crop"],
      tags: ["шкаф", "оффис"],
    },

    // ── Sofa / Couch ────────────────────────────────────────────────────────
    {
      tenantId: tid, categoryId: sofaId, brandId: "",
      name: "3-суудлын буйдан хөх", slug: "3-суудлын-буйдан-хөх",
      description: "Зөөлөн хөх даавуун бүрхүүлтэй 3 суудалтай буйдан. Модон хөлтэй.",
      price: 1490000, salePrice: 1290000, stock: 5, featured: true, status: "active",
      images: ["https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=600&h=600&fit=crop"],
      tags: ["буйдан", "зочны өрөө"],
    },
    {
      tenantId: tid, categoryId: sofaId, brandId: "",
      name: "L-хэлбэрийн буйдан саарал", slug: "l-хэлбэрийн-буйдан-саарал",
      description: "Өргөн L-хэлбэрийн буйдан. Дотор нь унтлагын ор болж ирдэг.",
      price: 2100000, salePrice: 1850000, stock: 3, featured: true, status: "active",
      images: ["https://images.unsplash.com/photo-1493663284031-b7e3aefcae8e?w=600&h=600&fit=crop"],
      tags: ["буйдан", "L-хэлбэр"],
    },
    {
      tenantId: tid, categoryId: sofaId, brandId: "",
      name: "2-суудлын буйдан арьсан", slug: "2-суудлын-буйдан-арьсан",
      description: "Хиймэл арьсан бүрхүүлтэй 2 суудалтай буйдан. Хар өнгө.",
      price: 980000, salePrice: null, stock: 7, featured: false, status: "active",
      images: ["https://images.unsplash.com/photo-1540574163026-643ea20ade25?w=600&h=600&fit=crop"],
      tags: ["буйдан", "арьсан"],
    },

    // ── Bedroom furniture ───────────────────────────────────────────────────
    {
      tenantId: tid, categoryId: bedroomId, brandId: "",
      name: "Хос ор 180×200 см", slug: "хос-ор-180x200",
      description: "Модон хүрээтэй хос ор. Матрас тохиромжтой. 180×200 см.",
      price: 1200000, salePrice: 990000, stock: 6, featured: true, status: "active",
      images: ["https://images.unsplash.com/photo-1616594039964-ae9021a400a0?w=600&h=600&fit=crop"],
      tags: ["ор", "унтлагын өрөө"],
    },
    {
      tenantId: tid, categoryId: bedroomId, brandId: "",
      name: "Цагираг цамхаг шүүгээ", slug: "цагираг-цамхаг-шүүгээ",
      description: "6 таваг, 2 хаалгатай унтлагын өрөөний шүүгээ. Цагаан өнгө.",
      price: 750000, salePrice: null, stock: 10, featured: false, status: "active",
      images: ["https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=600&h=600&fit=crop"],
      tags: ["шүүгээ", "унтлагын өрөө"],
    },
    {
      tenantId: tid, categoryId: bedroomId, brandId: "",
      name: "Орны хажуугийн тавиур", slug: "орны-хажуугийн-тавиур",
      description: "2 таваг бүхий унтлагын орны хажуугийн тавиур. Модон.",
      price: 180000, salePrice: 150000, stock: 25, featured: false, status: "active",
      images: ["https://images.unsplash.com/photo-1551298370-9d3d53740c72?w=600&h=600&fit=crop"],
      tags: ["тавиур", "унтлагын өрөө"],
    },

    // ── Kitchen furniture ───────────────────────────────────────────────────
    {
      tenantId: tid, categoryId: kitchenId, brandId: "",
      name: "Гал тогооны шүүгээ цагаан", slug: "гал-тогооны-шүүгээ-цагаан",
      description: "Цагаан меламин бүрхүүлтэй гал тогооны дээд шүүгээ. 80 см өргөн.",
      price: 420000, salePrice: null, stock: 14, featured: false, status: "active",
      images: ["https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=600&h=600&fit=crop"],
      tags: ["шүүгээ", "гал тогоо"],
    },
    {
      tenantId: tid, categoryId: kitchenId, brandId: "",
      name: "Гал тогооны сандал бар", slug: "гал-тогооны-сандал-бар",
      description: "Өндөр бар стул. Металл хөлтэй, PU суудалтай. 75 см өндөр.",
      price: 145000, salePrice: 120000, stock: 30, featured: false, status: "active",
      images: ["https://images.unsplash.com/photo-1611269154421-4e27233ac5c5?w=600&h=600&fit=crop"],
      tags: ["сандал", "бар", "гал тогоо"],
    },

    // ── Living room ─────────────────────────────────────────────────────────
    {
      tenantId: tid, categoryId: livingId, brandId: "",
      name: "Зочны өрөөний тавилгын иж бүрдэл", slug: "зочны-өрөөний-тавилгын-иж-бүрдэл",
      description: "3+2+1 суудалтай буйдан, кофе ширээ, тавиур багтсан иж бүрдэл.",
      price: 3800000, salePrice: 3200000, stock: 2, featured: true, status: "active",
      images: ["https://images.unsplash.com/photo-1540932239986-30128078f3c5?w=600&h=600&fit=crop"],
      tags: ["иж бүрдэл", "зочны өрөө"],
    },
    {
      tenantId: tid, categoryId: livingId, brandId: "",
      name: "Кофе ширээ шилэн хавтантай", slug: "кофе-ширээ-шилэн-хавтантай",
      description: "Дунд зочны өрөөний шилэн хавтантай кофе ширээ. 120×60 см.",
      price: 390000, salePrice: null, stock: 9, featured: false, status: "active",
      images: ["https://images.unsplash.com/photo-1549187774-b4e9b0445b41?w=600&h=600&fit=crop"],
      tags: ["кофе ширээ", "зочны өрөө"],
    },

    // ── Lighting ────────────────────────────────────────────────────────────
    {
      tenantId: tid, categoryId: lightingId, brandId: "",
      name: "LED дэнлүү дагзан", slug: "led-дэнлүү-дагзан",
      description: "Орчин үеийн дизайнтай LED дагзан дэнлүү. 36W, 3000K дулаан гэрэл.",
      price: 185000, salePrice: 155000, stock: 40, featured: true, status: "active",
      images: ["https://images.unsplash.com/photo-1524484485831-a92ffc0de03f?w=600&h=600&fit=crop"],
      tags: ["LED", "гэрэл", "дэнлүү"],
    },
    {
      tenantId: tid, categoryId: lightingId, brandId: "",
      name: "Шалны дэнлүү уламжлалт", slug: "шалны-дэнлүү-уламжлалт",
      description: "Зочны өрөөний шалны дэнлүү. Металл хүрээ, даавуун бүрхүүл.",
      price: 210000, salePrice: null, stock: 18, featured: false, status: "active",
      images: ["https://images.unsplash.com/photo-1507473885765-e6ed057f782c?w=600&h=600&fit=crop"],
      tags: ["дэнлүү", "шал"],
    },

    // ── Decorations ─────────────────────────────────────────────────────────
    {
      tenantId: tid, categoryId: decorSubId, brandId: "",
      name: "Ханын зураг 3 хэсгийн иж бүрдэл", slug: "ханын-зураг-3-хэсгийн-иж-бүрдэл",
      description: "Хийсвэр дизайнтай 3 хэсгийн ханын зурагны иж бүрдэл. 90×60 см.",
      price: 135000, salePrice: 110000, stock: 22, featured: false, status: "active",
      images: ["https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=600&h=600&fit=crop"],
      tags: ["ханын зураг", "чимэглэл"],
    },
    {
      tenantId: tid, categoryId: decorSubId, brandId: "",
      name: "Толь хүрээтэй дугуй", slug: "толь-хүрээтэй-дугуй",
      description: "Алтан өнгийн металл хүрээтэй дугуй толь. Диаметр 80 см.",
      price: 245000, salePrice: null, stock: 11, featured: false, status: "active",
      images: ["https://images.unsplash.com/photo-1567538096621-38d2284b23ff?w=600&h=600&fit=crop"],
      tags: ["толь", "чимэглэл"],
    },
  ]);

  console.log(`✅ Seeded go-to-market tenant:`);
  console.log(`   • 2 root categories (Тавилга, Гэрийн тохижилт)`);
  console.log(`   • 7 sub-categories`);
  console.log(`   • 18 products`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
