import { sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";

import { ok } from "../../lib/http.js";

interface HealthRouteOptions {
  readyCheck?: () => Promise<void>;
}

export const registerHealthRoutes: FastifyPluginAsync<HealthRouteOptions> = async (
  app,
  options
) => {
  app.get("/health", async () =>
    ok({
      service: "ai-ses-backend",
      status: "ok",
      timestamp: new Date().toISOString()
    })
  );

  app.get("/ready", async (_request, reply) => {
    try {
      const readyCheck =
        options.readyCheck ??
        (async () => {
          await app.db.execute(sql`select 1`);
        });

      await readyCheck();

      return ok({
        service: "ai-ses-backend",
        status: "ready",
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      app.log.error(error);

      return reply.status(503).send({
        error: {
          code: "DATABASE_UNAVAILABLE",
          message: "Database readiness check failed."
        }
      });
    }
  });
};
