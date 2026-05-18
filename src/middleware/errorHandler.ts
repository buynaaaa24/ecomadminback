import type { NextFunction, Request, Response } from "express";
import multer from "multer";

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({
        error: {
          code: "FILE_TOO_LARGE",
          message: "File exceeds maximum upload size",
        },
      });
      return;
    }
    res.status(400).json({
      error: { code: "UPLOAD_ERROR", message: err.message },
    });
    return;
  }

  const message = err instanceof Error ? err.message : "Internal server error";
  console.error(err);
  res.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      message,
    },
  });
}
