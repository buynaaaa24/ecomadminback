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
  if (!databaseUri.startsWith("mongodb://") && !databaseUri.startsWith("mongodb+srv://")) {
    throw new Error(`Invalid databaseUri for tenant connection: "${databaseUri}"`);
  }
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

  let timeoutId: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Database connection timeout (5.5s exceeded) to POS database at ${databaseUri}`));
    }, 5500);
  });

  try {
    const connectPromise = mongoose.createConnection(databaseUri, {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000,
      socketTimeoutMS: 15000,
      family: 4,
    }).asPromise();

    const conn = await Promise.race([connectPromise, timeoutPromise]);
    if (timeoutId) clearTimeout(timeoutId);
    pool.set(databaseUri, conn);
    console.log(`[db] Opened tenant connection: ${databaseUri}`);
    return conn;
  } catch (error) {
    if (timeoutId) clearTimeout(timeoutId);
    throw error;
  }
}

/** Close all pooled tenant connections (used for graceful shutdown). */
export async function closeTenantConnections(): Promise<void> {
  await Promise.all(
    [...pool.values()].map((c) => c.close().catch(() => {})),
  );
  pool.clear();
}
