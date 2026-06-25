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
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
      timeout: 10000,
    });

    const html = tokenRes.data;

    // Try multiple patterns to extract vqd token
    let vqd = "";
    const vqdPatterns = [
      /vqd=["']([^"']+)["']/,
      /vqd=([^&\s]+)/,
      /"vqd":"([^"]+)"/,
      /'vqd':'([^']+)'/,
      /vqd\s*=\s*["']([^"']+)["']/,
    ];

    for (const pattern of vqdPatterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        vqd = match[1];
        break;
      }
    }

    if (!vqd) {
      console.error("[DuckDuckGo Search] Could not extract vqd. HTML snippet:", html.slice(0, 500));
      throw new Error("Could not extract DuckDuckGo vqd token");
    }

    // Extract cookies from the first response
    const setCookie = tokenRes.headers["set-cookie"] as string | string[] | undefined;
    let cookies = "";
    if (Array.isArray(setCookie)) {
      cookies = setCookie.map((c) => c.split(";")[0]).join("; ");
    } else if (typeof setCookie === "string") {
      cookies = setCookie.split(";")[0];
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
        Accept: "application/json, text/javascript, */*; q=0.01",
        "Accept-Language": "en-US,en;q=0.9",
        "X-Requested-With": "XMLHttpRequest",
        ...(cookies ? { Cookie: cookies } : {}),
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
    if (err.response) {
      console.error("[DuckDuckGo Search] Status:", err.response.status);
      console.error("[DuckDuckGo Search] Data:", JSON.stringify(err.response.data).slice(0, 500));
    }
    throw new Error("DuckDuckGo image search failed");
  }
}

/**
 * Search images via Bing — no API key required.
 * Parses image metadata (murl) from the search results HTML.
 */
async function searchBingImages(query: string, perPage = 5): Promise<string[]> {
  try {
    const res = await axios.get("https://www.bing.com/images/search", {
      params: { q: query, form: "HDRSC2", first: "1" },
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Accept-Encoding": "gzip, deflate, br",
      },
      timeout: 10000,
    });

    const html = res.data as string;
    const urls: string[] = [];
    const seen = new Set<string>();

    // Bing embeds image data with "murl":"original_url"
    const murlRegex = /"murl"\s*:\s*"([^"]+)"/g;
    let match;
    while ((match = murlRegex.exec(html)) !== null) {
      const url = match[1].replace(/\\u002f/g, "/").replace(/\\/g, "");
      if (url.startsWith("http") && !seen.has(url)) {
        seen.add(url);
        urls.push(url);
      }
    }

    return urls.slice(0, perPage);
  } catch (err: any) {
    console.error("[Bing Search] Failed:", err.message || err);
    return [];
  }
}

/**
 * Search images via Wikimedia Commons — no API key required.
 * Uses the public MediaWiki API.
 */
async function searchWikimediaImages(query: string, perPage = 5): Promise<string[]> {
  try {
    const res = await axios.get("https://commons.wikimedia.org/w/api.php", {
      params: {
        action: "query",
        list: "search",
        srsearch: query,
        srnamespace: 6,
        format: "json",
        origin: "*",
        srlimit: perPage,
      },
      timeout: 10000,
    });

    const results = res.data?.query?.search || [];
    return results
      .map((r: any) => {
        const title = r.title.replace("File:", "");
        return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(title)}?width=800`;
      })
      .filter((url: string) => url.startsWith("http"));
  } catch (err: any) {
    console.error("[Wikimedia Search] Failed:", err.message || err);
    return [];
  }
}

/**
 * Search images across multiple providers.
 * Priority order:
 * 1. Pexels (free API key, no developer confirmation)
 * 2. Pixabay (free API key, no developer confirmation)
 * 3. Unsplash (if key configured)
 * 4. Scrapers (DuckDuckGo, Bing, Wikimedia) — unreliable on datacenter IPs
 */
async function searchImages(query: string, perPage = 5): Promise<{ urls: string[]; source: string; sources?: Record<string, number> }> {
  // 1. Try reliable API sources first
  const [pexelsUrls, pixabayUrls, unsplashUrls] = await Promise.all([
    searchPexelsImages(query, perPage),
    searchPixabayImages(query, perPage),
    UNSPLASH_ACCESS_KEY ? searchUnsplashImages(query, perPage).catch(() => [] as string[]) : Promise.resolve([] as string[]),
  ]);

  const apiUrls: string[] = [];
  const seenApi = new Set<string>();
  for (const url of [...pexelsUrls, ...pixabayUrls, ...unsplashUrls]) {
    if (!seenApi.has(url)) {
      seenApi.add(url);
      apiUrls.push(url);
    }
  }

  if (apiUrls.length > 0) {
    return {
      urls: apiUrls.slice(0, perPage * 2),
      source: "api",
      sources: {
        pexels: pexelsUrls.length,
        pixabay: pixabayUrls.length,
        unsplash: unsplashUrls.length,
      },
    };
  }

  // 2. Fall back to scrapers (often blocked on server IPs)
  const [ddgUrls, bingUrls, wikiUrls] = await Promise.all([
    searchDuckDuckGoImages(query, perPage).catch(() => [] as string[]),
    searchBingImages(query, perPage),
    searchWikimediaImages(query, perPage),
  ]);

  const seen = new Set<string>();
  const merged: string[] = [];
  const sources: Record<string, number> = {
    duckduckgo: ddgUrls.length,
    bing: bingUrls.length,
    wikimedia: wikiUrls.length,
  };

  let idx = 0;
  const maxResults = perPage * 2;
  while (merged.length < maxResults) {
    let added = false;
    for (const list of [ddgUrls, bingUrls, wikiUrls]) {
      if (idx < list.length) {
        const url = list[idx];
        if (!seen.has(url)) {
          seen.add(url);
          merged.push(url);
          added = true;
          if (merged.length >= maxResults) break;
        }
      }
    }
    if (!added) break;
    idx++;
  }

  if (merged.length === 0) {
    throw new Error(
      "All image search providers failed. " +
      "Get a free API key from Pexels (pexels.com/api) or Pixabay (pixabay.com/api/docs) — " +
      "no developer account confirmation needed. Set PEXELS_API_KEY or PIXABAY_API_KEY in your .env"
    );
  }

  return { urls: merged, source: "multi", sources };
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

async function searchPexelsImages(query: string, perPage = 5): Promise<string[]> {
  const apiKey = process.env.PEXELS_API_KEY || "";
  if (!apiKey) return [];

  try {
    const res = await axios.get("https://api.pexels.com/v1/search", {
      params: { query, per_page: perPage, orientation: "all" },
      headers: { Authorization: apiKey },
      timeout: 10000,
    });

    const photos = res.data?.photos || [];
    return photos
      .map((p: any) => p.src?.medium || p.src?.small || p.src?.large || p.src?.original)
      .filter((url: string) => url && url.startsWith("http"));
  } catch (err: any) {
    console.error("[Pexels Search] Failed:", err.message || err);
    return [];
  }
}

async function searchPixabayImages(query: string, perPage = 5): Promise<string[]> {
  const apiKey = process.env.PIXABAY_API_KEY || "";
  if (!apiKey) return [];

  try {
    const res = await axios.get("https://pixabay.com/api/", {
      params: { key: apiKey, q: query, per_page: perPage, image_type: "photo", safesearch: "true" },
      timeout: 10000,
    });

    const hits = res.data?.hits || [];
    return hits
      .map((h: any) => h.webformatURL || h.largeImageURL || h.previewURL)
      .filter((url: string) => url && url.startsWith("http"));
  } catch (err: any) {
    console.error("[Pixabay Search] Failed:", err.message || err);
    return [];
  }
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
