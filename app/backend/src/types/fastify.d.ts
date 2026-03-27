import type { db, pool } from "../db/client.js";

declare module "fastify" {
  interface FastifyInstance {
    db: typeof db;
    pg: typeof pool;
  }
}
