import type { Document } from "mongoose";

export function serializeDocument(doc: Document): Record<string, unknown> {
  const o = doc.toObject({ versionKey: false });
  const id = String(o._id);
  const { _id, ...rest } = o as Record<string, unknown> & { _id: unknown };
  return { id, ...rest };
}

export function serializeLean(
  doc: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!doc) return null;
  const { _id, __v, ...rest } = doc as Record<string, unknown> & {
    _id: unknown;
    __v?: number;
  };
  return { id: String(_id), ...rest };
}
