import type { FastifyServerOptions } from "fastify";

export function createLoggerOptions(
  nodeEnv: string
): NonNullable<FastifyServerOptions["logger"]> {
  if (nodeEnv === "development") {
    return {
      transport: {
        target: "pino-pretty",
        options: {
          translateTime: "SYS:standard",
          ignore: "pid,hostname"
        }
      }
    };
  }

  return true;
}
