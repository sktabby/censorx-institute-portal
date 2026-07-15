import { createApp } from "./app";
import { env } from "./config/env";
import { logger } from "./config/logger";
import { ApiError } from "./middleware/errorHandler";

process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "Unhandled promise rejection");
});

process.on("uncaughtException", (err) => {
  if (err instanceof ApiError) {
    logger.warn({ err }, "Uncaught operational ApiError");
    return;
  }

  logger.error({ err }, "Uncaught exception");
});

const app = createApp();

app.listen(env.PORT, () => {
  logger.info(`CensorX Institute Portal API listening on port ${env.PORT} (${env.NODE_ENV})`);
});
