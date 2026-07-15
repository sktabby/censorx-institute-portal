import type { NextFunction, Request, Response } from "express";
import { logger } from "../config/logger";

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({
    success: false,
    error: { code: "NOT_FOUND", message: "The requested resource was not found." },
  });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function globalErrorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (res.headersSent) {
    logger.error({ err, path: req.path }, "Error occurred after response headers were sent");
    return;
  }

  if (err instanceof ApiError) {
    logger.warn({ err, path: req.path }, "Handled API error");
    return res.status(err.status).json({ success: false, error: { code: err.code, message: err.message } });
  }

  logger.error({ err, path: req.path }, "Unhandled error");
  return res.status(500).json({
    success: false,
    error: { code: "INTERNAL_ERROR", message: "Something went wrong. Please try again." },
  });
}
