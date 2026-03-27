import fp from "fastify-plugin";

import { db, pool } from "../db/client.js";

export const dbPlugin = fp(async (fastify) => {
  fastify.decorate("db", db);
  fastify.decorate("pg", pool);

  fastify.addHook("onClose", async () => {
    await pool.end();
  });
});
