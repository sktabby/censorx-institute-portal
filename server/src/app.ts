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
      // Lets the portal read the file name and counts of a codes download.
      exposedHeaders: ["Content-Disposition", "X-Codes-Rows", "X-Codes-Unavailable"],
    })
  );
  // Create Codes sends the codes just made (Excel download) and student ID files: allow bigger
  // bodies on these two admin-only paths. Everything else, the app included, keeps 1 MB.
  app.use(["/api/v1/admin/codes/workbook", "/api/v1/admin/student-ids/parse"], express.json({ limit: "8mb" }));
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
