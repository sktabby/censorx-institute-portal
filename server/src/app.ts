import express from "express";
import helmet from "helmet";
import cors from "cors";
import pinoHttp from "pino-http";
import { env } from "./config/env";
import { logger } from "./config/logger";
import { notFoundHandler, globalErrorHandler } from "./middleware/errorHandler";

import publicRoutes from "./routes/publicRoutes";
import authRoutes from "./routes/authRoutes";
import adminRoutes from "./routes/adminRoutes";
import schoolRoutes from "./routes/schoolRoutes";
import organizationRoutes from "./routes/organizationRoutes";

export function createApp() {
  const app = express();

  app.set("trust proxy", Number(env.TRUST_PROXY));

  const allowedOrigins = env.CLIENT_ORIGINS.split(",").map((o) => o.trim());

  app.use(helmet());
  app.use(
    cors({
      origin: allowedOrigins,
      credentials: true,
    })
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(pinoHttp({ logger }));

  // TODO: When APP_CHECK_ENFORCED=true, verify the X-Firebase-AppCheck
  // header here (via firebase-admin/app-check) before requests reach
  // the redemption routes. Left as an explicit follow-up because App
  // Check must first be configured in the shared Firebase project.

  const v1 = express.Router();
  v1.use(publicRoutes);
  v1.use(authRoutes);
  v1.use(adminRoutes);
  v1.use(schoolRoutes);
  v1.use(organizationRoutes);

  app.use("/api/v1", v1);

  app.use(notFoundHandler);
  app.use(globalErrorHandler);

  return app;
}
