import { Router } from "express";
import mongoose from "mongoose";
import { Order } from "../models/Order.js";
import { getOrderModel } from "../models/orderSchema.js";
import { Product } from "../models/Product.js";
import { getProductModel } from "../models/productSchema.js";
import { Tenant } from "../models/Tenant.js";
import { getTenantConnection } from "../db.js";
import { requireAdminAuth } from "../middleware/adminAuth.js";
import { serializeDocument, serializeLean } from "../util/serialize.js";

export const ordersRouter = Router();

/**
 * Resolve the Order model to use for a given tenantId.
 */
async function resolveOrderModel(tenantId: string | null | undefined): Promise<{
  Model: typeof Order | ReturnType<typeof getOrderModel>;
  useTenantFilter: boolean;
}> {
  if (tenantId) {
    const tenant = await Tenant.findById(tenantId).lean<{ databaseUri?: string }>();
    const uri = tenant?.databaseUri;
    if (uri && (uri.startsWith("mongodb://") || uri.startsWith("mongodb+srv://"))) {
      const conn = await getTenantConnection(uri);
      return { Model: getOrderModel(conn), useTenantFilter: false };
    }
  }
  return { Model: Order, useTenantFilter: true };
}

/**
 * Resolve the Product model to use for a given tenantId.
 */
async function resolveProductModel(tenantId: string | null | undefined): Promise<{
  Model: typeof Product | ReturnType<typeof getProductModel>;
  useTenantFilter: boolean;
}> {
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

// ── Public Checkout Endpoint ───────────────────────────────────────────────────

ordersRouter.post("/public", async (req, res, next) => {
  try {
    const { tenantId, customerInfo, items, paymentMethod } = req.body;

    if (!tenantId) {
      res.status(400).json({ error: "tenantId is required" });
      return;
    }
    if (!customerInfo || !customerInfo.lastName || !customerInfo.firstName || !customerInfo.phone || !customerInfo.address) {
      res.status(400).json({ error: "Customer shipping information is incomplete" });
      return;
    }
    if (!items || !Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: "Order cart items are empty" });
      return;
    }
    if (!paymentMethod) {
      res.status(400).json({ error: "Payment method is required" });
      return;
    }

    const { Model: ProductModel } = await resolveProductModel(tenantId);
    const succeededDecrements: { productId: string; quantity: number }[] = [];

    try {
      // 1. Try atomic stock decrement loop (Saga compensation pattern)
      for (const item of items) {
        const qty = Number(item.quantity);
        if (isNaN(qty) || qty <= 0) {
          throw new Error(`Invalid item quantity for "${item.name}"`);
        }

        const updated = await ProductModel.findOneAndUpdate(
          { _id: item.productId, stock: { $gte: qty } },
          { $inc: { stock: -qty } },
          { new: true }
        );

        if (!updated) {
          throw new Error(`"${item.name}" барааны үлдэгдэл хүрэлцэхгүй байна.`);
        }

        succeededDecrements.push({ productId: item.productId, quantity: qty });
      }
    } catch (err: any) {
      // Compensate / Rollback previously successful decrements
      for (const decomp of succeededDecrements) {
        await ProductModel.updateOne(
          { _id: decomp.productId },
          { $inc: { stock: decomp.quantity } }
        );
      }
      res.status(400).json({ error: err.message });
      return;
    }

    // 2. Compute total amount
    const total = items.reduce((sum, item) => sum + Number(item.price) * Number(item.quantity), 0);

    // 3. Generate tracking order number
    const orderNumber = `E-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

    // 4. Create and save the order document
    const { Model: OrderModel, useTenantFilter } = await resolveOrderModel(tenantId);
    
    const orderBody: Record<string, any> = {
      customerInfo,
      items,
      total,
      paymentMethod,
      paymentStatus: "pending",
      orderStatus: "pending",
      orderNumber,
    };

    if (useTenantFilter) {
      orderBody.tenantId = new mongoose.Types.ObjectId(tenantId);
    }

    const doc = await OrderModel.create(orderBody);
    res.status(201).json({ data: serializeDocument(doc) });
  } catch (e) {
    next(e);
  }
});

// ── Admin Order Endpoints ──────────────────────────────────────────────────────

ordersRouter.use(requireAdminAuth);

/** Get all orders scoped by tenantId */
ordersRouter.get("/", async (req, res, next) => {
  try {
    const a = req.admin!;
    const targetTenantId = a.role === "superadmin"
      ? (req.query.tenantId as string | undefined)
      : a.tenantId ?? undefined;

    const { Model, useTenantFilter } = await resolveOrderModel(targetTenantId);
    const filter: Record<string, unknown> = {};
    if (useTenantFilter && targetTenantId) {
      filter.tenantId = new mongoose.Types.ObjectId(targetTenantId);
    }

    const list = await Model.find(filter).sort({ createdAt: -1 }).lean();
    res.json({ data: list.map((t) => serializeLean(t as Record<string, unknown>)) });
  } catch (e) {
    next(e);
  }
});

/** Update order status (with auto inventory recovery if cancelled) */
ordersRouter.patch("/:id", async (req, res, next) => {
  try {
    const a = req.admin!;
    const tenantId = a.role !== "superadmin" ? a.tenantId : undefined;
    const { orderStatus, paymentStatus } = req.body;

    const { Model: OrderModel, useTenantFilter } = await resolveOrderModel(tenantId);
    const filter: Record<string, unknown> = { _id: req.params.id };
    if (useTenantFilter && tenantId) filter.tenantId = tenantId;

    const existingOrder = await OrderModel.findOne(filter);
    if (!existingOrder) {
      res.status(404).json({ error: "Order not found" });
      return;
    }

    // Dynamic stock recovery on cancellation
    if (orderStatus === "cancelled" && existingOrder.orderStatus !== "cancelled") {
      const { Model: ProductModel } = await resolveProductModel(tenantId || existingOrder.tenantId?.toString());
      
      for (const item of existingOrder.items) {
        await ProductModel.updateOne(
          { _id: item.productId },
          { $inc: { stock: Number(item.quantity) } }
        );
      }
    }

    // Save fields
    if (orderStatus) existingOrder.orderStatus = orderStatus;
    if (paymentStatus) existingOrder.paymentStatus = paymentStatus;

    const doc = await existingOrder.save();
    res.json({ data: serializeDocument(doc) });
  } catch (e) {
    next(e);
  }
});
