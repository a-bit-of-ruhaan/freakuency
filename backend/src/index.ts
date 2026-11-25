import { connectCache, disconnectCache } from "./cache.js";
import { config } from "./config.js";
import { prisma } from "./db.js";
import app from "./app.js";

async function start(): Promise<void> {
  await prisma.$connect();
  await connectCache();
  const server = app.listen(config.port, () => {
    console.info(`Freakuency API listening on http://localhost:${config.port}`);
  });

  const shutdown = (signal: string) => {
    console.info(`${signal} received; shutting down API`);
    server.close((error) => {
      if (error) {
        console.error("HTTP server shutdown failed:", error);
        process.exitCode = 1;
      }
      void Promise.all([prisma.$disconnect(), disconnectCache()]).catch((shutdownError: unknown) => {
        console.error("Service shutdown failed:", shutdownError);
        process.exitCode = 1;
      });
    });
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

start().catch((error: unknown) => {
  console.error("Could not start the Freakuency API:", error);
  process.exitCode = 1;
});
