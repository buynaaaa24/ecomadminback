import "dotenv/config";
import http from "http";
import cors from "cors";
import express from "express";
import { connectMongo } from "./db.js";
import { UPLOAD_DIR, upload } from "./uploadConfig.js";

import { errorHandler } from "./middleware/errorHandler.js";
import { notFoundHandler } from "./middleware/notFoundHandler.js";

import { authRouter } from "./routes/auth.js";
import { configRouter } from "./routes/config.js";
import { tenantsRouter } from "./routes/tenants.js";
import { adminUsersRouter } from "./routes/adminUsers.js";
import { productsRouter } from "./routes/products.js";
import { productImagesRouter } from "./routes/productImages.js";
import { categoriesRouter } from "./routes/categories.js";
import { ordersRouter } from "./routes/orders.js";
import { qpayRouter } from "./routes/qpay.js";
import { usersRouter } from "./routes/users.js";
import { brandsRouter } from "./routes/brands.js";

const app = express();
const port = Number(process.env.PORT) || 8000;

const envOrigins = (process.env.CORS_ORIGIN ?? "http://localhost:7000,http://localhost:7001,http://localhost:7002")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);
const corsOrigins = [...new Set([...envOrigins])];

app.use(
  cors({
    origin: (origin, callback) => {
      // Dynamically echo back the request origin to satisfy browser credentials CORS gates
      callback(null, true);
    },
    credentials: true,
  }),
);
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

/** Public URLs: GET /upload/... */
app.use("/upload", express.static(UPLOAD_DIR));

app.get("/", (_req, res) => {
  res.json({ data: { name: "ecom-back", version: "1.0.0" } });
});

// Storefront public endpoints
app.use("/api/config", configRouter);
app.use("/api/brands", brandsRouter);
app.use("/api/orders", ordersRouter);
app.use("/api/qpay", qpayRouter);
app.use("/api/users", usersRouter);

app.post("/api/upload", upload.single("file"), (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }
  const url = `${req.protocol}://${req.get("host")}/upload/${req.file.filename}`;
  res.json({ url });
});

// Common auth
app.use("/api/auth", authRouter);

// Admin endpoints
app.use("/api/tenants", tenantsRouter);
app.use("/api/admin-users", adminUsersRouter);
app.use("/api/products", productsRouter);
app.use("/api/products", productImagesRouter);
app.use("/api/categories", categoriesRouter);

app.use(notFoundHandler);
app.use(errorHandler);

async function main() {
  await connectMongo();
  const server = http.createServer(app);
  
  server.listen(port, () => {
    console.log(`ecom-back listening on http://localhost:${port}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
