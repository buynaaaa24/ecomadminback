import mongoose from "mongoose";

const CENTRAL_URI =
  process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017/ecommerce";

// Per-tenant connection pool: databaseUri -> active mongoose.Connection
const pool = new Map<string, mongoose.Connection>();

export async function connectMongo(): Promise<void> {
  await mongoose.connect(CENTRAL_URI);
  console.log(`[db] Connected to central MongoDB: ${CENTRAL_URI}`);
}

/**
 * Returns a cached mongoose.Connection for the given URI, creating one if
 * it does not exist yet. Safe to call on every request — connections are reused.
 */
export async function getTenantConnection(
  databaseUri: string,
): Promise<mongoose.Connection> {
  const existing = pool.get(databaseUri);
  if (existing && existing.readyState === 1) return existing;

  // Close stale connection if any
  if (existing) {
    try {
      await existing.close();
    } catch {
      /* ignore */
    }
    pool.delete(databaseUri);
  }

  const conn = await mongoose.createConnection(databaseUri).asPromise();
  pool.set(databaseUri, conn);
  console.log(`[db] Opened tenant connection: ${databaseUri}`);
  return conn;
}

/** Close all pooled tenant connections (used for graceful shutdown). */
export async function closeTenantConnections(): Promise<void> {
  await Promise.all(
    [...pool.values()].map((c) => c.close().catch(() => {})),
  );
  pool.clear();
}
