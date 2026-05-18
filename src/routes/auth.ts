import { Router } from "express";
import { adminLoginHandler, requireAdminAuth } from "../middleware/adminAuth.js";
import { upload } from "../uploadConfig.js";

export const authRouter = Router();

authRouter.post("/login", adminLoginHandler);

authRouter.get("/me", requireAdminAuth, (req, res) => {
  res.json({ data: { user: req.admin } });
});

authRouter.post("/logout", (req, res) => {
  res.status(204).send();
});

// Generic upload endpoint
authRouter.post(
  "/upload",
  requireAdminAuth,
  upload.single("file"),
  (req: any, res: any, next: any) => {
    try {
      if (!req.file) {
        res.status(400).json({
          error: { code: "VALIDATION_ERROR", message: "file field required" },
        });
        return;
      }
      const publicPath = `/upload/${req.file.filename}`;
      res.status(201).json({
        data: { path: publicPath },
      });
    } catch (e) {
      next(e);
    }
  },
);
