import { env } from "./config/env.js";
import { createApp } from "./app.js";

async function start(): Promise<void> {
  const app = await createApp();

  try {
    await app.listen({
      host: env.APP_HOST,
      port: env.APP_PORT
    });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

void start();
