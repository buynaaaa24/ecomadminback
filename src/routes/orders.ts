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
import { issueEbarimt } from "../util/ebarimt.js";

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
    const tenant = await Tenant.findById(tenantId).lean<{ 
      posDbUri?: string; 
      posBranchId?: string; 
      posOrgId?: string; 
      emDbUri?: string; 
      emBranchId?: string; 
      emOrgId?: string; 
      ebarimtTin?: string;
      ebarimtDistrict?: string;
      ebarimtKhoroo?: string;
      ebarimtEnabled?: boolean;
      ebarimtAutoSend?: boolean;
      shippingFee?: number;
      shippingFreeThreshold?: number;
    }>();
    const posUri = tenant?.posDbUri;
    const emUri = tenant?.emDbUri;

    const succeededDecrements: Array<{
      productId: string;
      quantity: number;
      type: "ecom" | "pos" | "em";
      posProductCode?: string;
      posDbUri?: string;
      posBranchId?: string;
      posOrgId?: string;
      emProductCode?: string;
      emDbUri?: string;
    }> = [];

    try {
      // 1. Try atomic stock decrement loop (Saga compensation pattern)
      for (const item of items) {
        const qty = Number(item.quantity);
        if (isNaN(qty) || qty <= 0) {
          throw new Error(`Invalid item quantity for "${item.name}"`);
        }

        const productDoc = await ProductModel.findById(item.productId).lean<{ isPosLinked?: boolean; posProductCode?: string; isEmLinked?: boolean; emProductCode?: string }>();
        if (!productDoc) {
          throw new Error(`"${item.name}" бараа олдсонгүй.`);
        }

        if (productDoc.isPosLinked && productDoc.posProductCode && posUri && (posUri.startsWith("http://") || posUri.startsWith("https://"))) {
          const decResponse = await fetch(`${posUri.replace(/\/$/, "")}/api/ecom/pos-decrement`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              code: productDoc.posProductCode,
              quantity: qty,
              salbariinId: tenant.posBranchId,
              baiguullagiinId: tenant.posOrgId,
            }),
          });
          if (!decResponse.ok) {
            const errBody = await decResponse.json().catch(() => ({}));
            throw new Error(errBody.error || `"${item.name}" барааны POS үлдэгдэл хүрэлцэхгүй байна.`);
          }

          // Keep e-commerce catalog stock cached values in sync
          await ProductModel.updateOne({ _id: item.productId }, { $inc: { stock: -qty } });

          succeededDecrements.push({
            productId: item.productId,
            quantity: qty,
            type: "pos",
            posProductCode: productDoc.posProductCode,
            posDbUri: posUri,
            posBranchId: tenant.posBranchId,
            posOrgId: tenant.posOrgId,
          });
        } else if (productDoc.isEmLinked && productDoc.emProductCode && emUri && (emUri.startsWith("http://") || emUri.startsWith("https://"))) {
          const decResponse = await fetch(`${emUri.replace(/\/$/, "")}/api/ecom/em-decrement`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              code: productDoc.emProductCode,
              quantity: qty,
              salbariinId: tenant?.emBranchId || "",
              baiguullagiinId: tenant?.emOrgId || "",
            }),
          });
          if (!decResponse.ok) {
            const errBody = await decResponse.json().catch(() => ({}));
            throw new Error(errBody.error || `"${item.name}" барааны EM үлдэгдэл хүрэлцэхгүй байна.`);
          }

          // Keep e-commerce catalog stock cached values in sync
          await ProductModel.updateOne({ _id: item.productId }, { $inc: { stock: -qty } });

          succeededDecrements.push({
            productId: item.productId,
            quantity: qty,
            type: "em",
            emProductCode: productDoc.emProductCode,
            emDbUri: emUri,
          });
        } else {
          const updated = await ProductModel.findOneAndUpdate(
            { _id: item.productId, stock: { $gte: qty } },
            { $inc: { stock: -qty } },
            { new: true }
          );

          if (!updated) {
            throw new Error(`"${item.name}" барааны үлдэгдэл хүрэлцэхгүй байна.`);
          }

          succeededDecrements.push({ productId: item.productId, quantity: qty, type: "ecom" });
        }
      }
    } catch (err: any) {
      // Compensate / Rollback previously successful decrements
      for (const decomp of succeededDecrements) {
        if (decomp.type === "pos") {
          try {
            if (decomp.posDbUri!.startsWith("http://") || decomp.posDbUri!.startsWith("https://")) {
              await fetch(`${decomp.posDbUri!.replace(/\/$/, "")}/api/ecom/pos-increment`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  code: decomp.posProductCode,
                  quantity: decomp.quantity,
                  salbariinId: decomp.posBranchId,
                  baiguullagiinId: decomp.posOrgId,
                }),
              });
            }
            await ProductModel.updateOne({ _id: decomp.productId }, { $inc: { stock: decomp.quantity } });
          } catch (posErr) {
            console.error(`[POS-ROLLBACK] Critical error rolling back stock for ${decomp.posProductCode}:`, posErr);
          }
        } else if (decomp.type === "em") {
          try {
            if (decomp.emDbUri!.startsWith("http://") || decomp.emDbUri!.startsWith("https://")) {
              await fetch(`${decomp.emDbUri!.replace(/\/$/, "")}/api/ecom/em-increment`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  code: decomp.emProductCode,
                  quantity: decomp.quantity,
                }),
              });
            }
            await ProductModel.updateOne({ _id: decomp.productId }, { $inc: { stock: decomp.quantity } });
          } catch (emErr) {
            console.error(`[EM-ROLLBACK] Critical error rolling back stock for ${decomp.emProductCode}:`, emErr);
          }
        } else {
          await ProductModel.updateOne(
            { _id: decomp.productId },
            { $inc: { stock: decomp.quantity } }
          );
        }
      }
      res.status(400).json({ error: err.message });
      return;
    }

    // 2. Compute total amount including shipping fee
    const itemsTotal = items.reduce((sum, item) => sum + Number(item.price) * Number(item.quantity), 0);
    const fee = typeof tenant?.shippingFee === "number" ? tenant.shippingFee : 15000;
    const threshold = typeof tenant?.shippingFreeThreshold === "number" ? tenant.shippingFreeThreshold : 500000;
    const shipping = itemsTotal >= threshold ? 0 : fee;
    const total = itemsTotal + shipping;

    // 3. Generate tracking order number
    const orderNumber = `E-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

    const paymentStatus = paymentMethod === "qpay" ? "paid" : "pending";

    const savedItems = items.map((item) => {
      return {
        productId: item.productId,
        name: item.name,
        quantity: item.quantity,
        price: item.price,
        ebarimtBillId: "",
        ebarimtLottery: "",
        ebarimtQrData: "",
      };
    });

    // Auto-generate Ebarimt if payment is successful and ebarimt integration is active + auto-send is enabled
    if (paymentStatus === "paid" && tenant?.ebarimtEnabled && tenant?.ebarimtAutoSend) {
      try {
        console.log(`[Ebarimt Auto] Generating ebarimt for Order: ${orderNumber}`);
        const tempOrder = {
          orderNumber,
          items: savedItems,
        };
        const ebarimtDoc = await issueEbarimt(tempOrder, tenant);
        if (ebarimtDoc) {
          // Assign ebarimt details to all savedItems
          for (const item of savedItems) {
            item.ebarimtBillId = ebarimtDoc.billId || "";
            item.ebarimtLottery = ebarimtDoc.lottery || "";
            item.ebarimtQrData = ebarimtDoc.qrData || "";
          }
          console.log(`[Ebarimt Auto] Success! Bill ID: ${ebarimtDoc.billId}`);
        }
      } catch (ebErr: any) {
        console.error("[Ebarimt Auto] Failed to generate ebarimt:", ebErr.message || ebErr);
      }
    }

    // 4. Create and save the order document
    const { Model: OrderModel, useTenantFilter } = await resolveOrderModel(tenantId);
    
    const orderBody: Record<string, any> = {
      customerInfo,
      items: savedItems,
      total,
      shippingFee: shipping,
      paymentMethod,
      paymentStatus,
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
      const activeTenantId = tenantId || existingOrder.tenantId?.toString();
      const { Model: ProductModel } = await resolveProductModel(activeTenantId);
      
      const tenant = await Tenant.findById(activeTenantId).lean<{ posDbUri?: string; posBranchId?: string; posOrgId?: string; emDbUri?: string }>();
      const posUri = tenant?.posDbUri;
      const emUri = tenant?.emDbUri;

      for (const item of existingOrder.items) {
        const qty = Number(item.quantity);
        const productDoc = await ProductModel.findById(item.productId).lean<{ isPosLinked?: boolean; posProductCode?: string; isEmLinked?: boolean; emProductCode?: string }>();

        if (productDoc?.isPosLinked && productDoc?.posProductCode && posUri && (posUri.startsWith("http://") || posUri.startsWith("https://"))) {
          try {
            await fetch(`${posUri.replace(/\/$/, "")}/api/ecom/pos-increment`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                code: productDoc.posProductCode,
                quantity: qty,
                salbariinId: tenant.posBranchId,
                baiguullagiinId: tenant.posOrgId,
              }),
            });
            await ProductModel.updateOne({ _id: item.productId }, { $inc: { stock: qty } });
          } catch (posErr) {
            console.error(`[POS-CANCEL-RECOVERY] Failed to restore POS stock for product code ${productDoc.posProductCode}:`, posErr);
            await ProductModel.updateOne({ _id: item.productId }, { $inc: { stock: qty } });
          }
        } else if (productDoc?.isEmLinked && productDoc?.emProductCode && emUri && (emUri.startsWith("http://") || emUri.startsWith("https://"))) {
          try {
            await fetch(`${emUri.replace(/\/$/, "")}/api/ecom/em-increment`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                code: productDoc.emProductCode,
                quantity: qty,
              }),
            });
            await ProductModel.updateOne({ _id: item.productId }, { $inc: { stock: qty } });
          } catch (emErr) {
            console.error(`[EM-CANCEL-RECOVERY] Failed to restore EM stock for product code ${productDoc.emProductCode}:`, emErr);
            await ProductModel.updateOne({ _id: item.productId }, { $inc: { stock: qty } });
          }
        } else {
          await ProductModel.updateOne(
            { _id: item.productId },
            { $inc: { stock: qty } }
          );
        }
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
