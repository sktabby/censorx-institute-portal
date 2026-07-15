import type { NextFunction, Request, Response } from "express";
import type { ZodSchema } from "zod";
import { ApiError } from "./errorHandler";

export const validateBody = (schema: ZodSchema) => (req: Request, _res: Response, next: NextFunction) => {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    return next(new ApiError(400, "VALIDATION_ERROR", result.error.issues.map((i) => i.message).join("; ")));
  }
  req.body = result.data;
  next();
};

export const validateParams = (schema: ZodSchema) => (req: Request, _res: Response, next: NextFunction) => {
  const result = schema.safeParse(req.params);
  if (!result.success) {
    return next(new ApiError(400, "VALIDATION_ERROR", result.error.issues.map((i) => i.message).join("; ")));
  }
  req.params = result.data as typeof req.params;
  next();
};

export const validateQuery = (schema: ZodSchema) => (req: Request, _res: Response, next: NextFunction) => {
  const result = schema.safeParse(req.query);
  if (!result.success) {
    return next(new ApiError(400, "VALIDATION_ERROR", result.error.issues.map((i) => i.message).join("; ")));
  }
  req.query = result.data as typeof req.query;
  next();
};
