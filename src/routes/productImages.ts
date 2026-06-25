import { Router } from "express";
import axios from "axios";
import fs from "fs";
import path from "path";
import { Product } from "../models/Product.js";
import { getProductModel } from "../models/productSchema.js";
import { Tenant } from "../models/Tenant.js";
import { getTenantConnection } from "../db.js";
import { requireAdminAuth } from "../middleware/adminAuth.js";
import { serializeDocument, serializeLean } from "../util/serialize.js";
import { UPLOAD_DIR } from "../uploadConfig.js";
import mongoose from "mongoose";

export const productImagesRouter = Router();

const UNSPLASH_ACCESS_KEY = process.env.UNSPLASH_ACCESS_KEY || "";

/**
 * Search images via DuckDuckGo — no API key required.
 * Extracts a vqd token from the search page, then queries the internal i.js endpoint.
 */
async function searchDuckDuckGoImages(query: string, perPage = 5): Promise<string[]> {
  try {
    // 1. Grab a vqd token from the HTML search page
    const tokenRes = await axios.get("https://duckduckgo.com/", {
      params: { q: query, iax: "images", ia: "images" },
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html",
      },
      timeout: 10000,
    });

    const html = tokenRes.data;
    const vqdMatch = html.match(/vqd=\"?([^"\s]+)\"?/);
    const vqd = vqdMatch ? vqdMatch[1] : "";

    if (!vqd) {
      throw new Error("Could not extract DuckDuckGo vqd token");
    }

    // 2. Query the internal image JSON endpoint
    const imgRes = await axios.get("https://duckduckgo.com/i.js", {
      params: {
        q: query,
        o: "json",
        vqd,
        f: ",,,",
        l: "wt-wt",
      },
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Referer: "https://duckduckgo.com/",
        Accept: "application/json",
      },
      timeout: 10000,
    });

    const results = imgRes.data?.results || [];
    const urls = results
      .slice(0, perPage)
      .map((r: any) => r.image)
      .filter((url: string) => url && url.startsWith("http"));

    return urls;
  } catch (err: any) {
    console.error("[DuckDuckGo Search] Failed:", err.message || err);
    throw new Error("DuckDuckGo image search failed. You can switch to Unsplash by setting UNSPLASH_ACCESS_KEY in your .env");
  }
}

/**
 * Auto-detect which provider to use:
 * - If UNSPLASH_ACCESS_KEY is set → Unsplash (higher quality, more reliable)
 * - Otherwise → DuckDuckGo (zero setup, no API key)
 */
async function searchImages(query: string, perPage = 5): Promise<{ urls: string[]; source: string }> {
  if (UNSPLASH_ACCESS_KEY) {
    const urls = await searchUnsplashImages(query, perPage);
    return { urls, source: "unsplash" };
  }
  const urls = await searchDuckDuckGoImages(query, perPage);
  return { urls, source: "duckduckgo" };
}

async function resolveProductModel(tenantId: string | null | undefined) {
  if (tenantId) {
    const tenant = await Tenant.findById(tenantId).lean<{ databaseUri?: string }>();
    const uri = tenant?.databaseUri;
    if (uri && (uri.startsWith("mongodb://") || uri.startsWith("mongodb+srv://"))) {
      const conn = await getTenantConnection(uri);
      return { Model: getProductModel(conn), useTenantFilter: false };
    }
  }
  return { Model: Product, useTenantFilter: true };
}

async function searchUnsplashImages(query: string, perPage = 5): Promise<string[]> {
  if (!UNSPLASH_ACCESS_KEY) {
    throw new Error("UNSPLASH_ACCESS_KEY is not configured. Add it to your .env file. Get a free key at https://unsplash.com/developers");
  }

  const res = await axios.get("https://api.unsplash.com/search/photos", {
    params: { query, per_page: perPage, lang: "mn" },
    headers: { Authorization: `Client-ID ${UNSPLASH_ACCESS_KEY}` },
    timeout: 10000,
  });

  const results = res.data?.results || [];
  return results.map((r: any) => r.urls?.regular || r.urls?.small || r.urls?.thumb).filter(Boolean);
}

async function downloadImage(url: string): Promise<{ buffer: Buffer; ext: string }> {
  const response = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 15000,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
  });

  const buffer = Buffer.from(response.data, "binary");
  const contentType = (response.headers["content-type"] as string) || "";

  let ext = ".jpg";
  if (contentType.includes("png")) ext = ".png";
  else if (contentType.includes("gif")) ext = ".gif";
  else if (contentType.includes("webp")) ext = ".webp";
  else if (contentType.includes("svg")) ext = ".svg";

  return { buffer, ext };
}

productImagesRouter.use(requireAdminAuth);

/**
 * POST /api/products/image-search
 * Search for images using a query string.
 */
productImagesRouter.post("/image-search", async (req, res, next) => {
  try {
    const { query, perPage = 5 } = req.body;
    if (!query || typeof query !== "string") {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "query is required" } });
      return;
    }

    const { urls, source } = await searchImages(query, Number(perPage) || 5);
    res.json({ data: { urls, source } });
  } catch (err: any) {
    console.error("[ImageSearch] Error:", err.message || err);
    next(err);
  }
});

/**
 * POST /api/products/bulk-image-inject
 * Downloads images for selected products and updates their image arrays.
 * Body: {
 *   injections: Array<{ productId: string, imageUrl: string }>,
 *   tenantId?: string
 * }
 */
productImagesRouter.post("/bulk-image-inject", async (req, res, next) => {
  try {
    const a = req.admin!;
    const { injections } = req.body;
    const targetTenantId = a.role === "superadmin"
      ? (req.body.tenantId as string | undefined)
      : a.tenantId ?? undefined;

    if (!Array.isArray(injections) || injections.length === 0) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "injections array is required" } });
      return;
    }

    const { Model, useTenantFilter } = await resolveProductModel(targetTenantId);
    const results: Array<{ productId: string; success: boolean; imageUrl?: string; error?: string }> = [];

    for (const item of injections as Array<{ productId: string; imageUrl: string }>) {
      const { productId, imageUrl } = item;
      if (!productId || !imageUrl) {
        results.push({ productId: productId || "unknown", success: false, error: "Missing productId or imageUrl" });
        continue;
      }

      try {
        const { buffer, ext } = await downloadImage(imageUrl);
        const rand = Math.random().toString(36).slice(2, 8);
        const filename = `auto-${Date.now()}-${rand}${ext}`;
        const filePath = path.join(UPLOAD_DIR, filename);
        fs.writeFileSync(filePath, buffer);

        const localUrl = `/upload/${filename}`;

        const filter: Record<string, unknown> = { _id: productId };
        if (useTenantFilter && targetTenantId) {
          filter.tenantId = new mongoose.Types.ObjectId(targetTenantId);
        }

        const doc = await Model.findOne(filter).lean<{ images?: string[] }>();
        if (!doc) {
          results.push({ productId, success: false, error: "Product not found" });
          continue;
        }

        const currentImages = doc.images || [];
        const updatedImages = [...currentImages, localUrl];

        const updated = await Model.findOneAndUpdate(
          filter,
          { images: updatedImages },
          { new: true }
        );

        if (updated) {
          results.push({ productId, success: true, imageUrl: localUrl });
        } else {
          results.push({ productId, success: false, error: "Failed to update product" });
        }
      } catch (downloadErr: any) {
        console.error(`[BulkImageInject] Failed for product ${productId}:`, downloadErr.message || downloadErr);
        results.push({ productId, success: false, error: downloadErr.message || "Download failed" });
      }
    }

    res.json({ data: { results, total: injections.length, successCount: results.filter((r) => r.success).length } });
  } catch (err: any) {
    console.error("[BulkImageInject] Error:", err.message || err);
    next(err);
  }
});

/**
 * GET /api/products/without-images
 * Returns products that have no images, for easy selection.
 */
productImagesRouter.get("/without-images", async (req, res, next) => {
  try {
    const a = req.admin!;
    const targetTenantId = a.role === "superadmin"
      ? (req.query.tenantId as string | undefined)
      : a.tenantId ?? undefined;

    const { Model, useTenantFilter } = await resolveProductModel(targetTenantId);
    const filter: Record<string, unknown> = { $or: [{ images: { $size: 0 } }, { images: { $exists: false } }] };
    if (useTenantFilter && targetTenantId) {
      filter.tenantId = new mongoose.Types.ObjectId(targetTenantId);
    }

    const list = await Model.find(filter).sort({ createdAt: -1 }).lean();
    res.json({ data: list.map((t) => serializeLean(t as Record<string, unknown>)) });
  } catch (e) {
    next(e);
  }
});
