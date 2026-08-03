import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodType } from 'zod';

/** Thrown by route handlers; turned into a JSON body by the error middleware. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const badRequest = (m: string, d?: unknown) => new HttpError(400, m, d);
export const unauthorized = (m = 'Not signed in') => new HttpError(401, m);
export const forbidden = (m = 'Not allowed') => new HttpError(403, m);
export const notFound = (m = 'Not found') => new HttpError(404, m);
export const conflict = (m: string, d?: unknown) => new HttpError(409, m, d);

/** Wraps an async handler so a rejected promise reaches the error middleware. */
export function route<T>(
  handler: (req: Request, res: Response) => Promise<T> | T,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    Promise.resolve(handler(req, res)).catch(next);
  };
}

/** Express 5 types path params as `string | string[] | undefined`; narrow once, here. */
export function param(req: Request, name: string): string {
  const raw = (req.params as Record<string, string | string[] | undefined>)[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string' || value === '') throw badRequest(`Missing :${name} in the path`);
  return value;
}

export function parseBody<S extends ZodType>(schema: S, body: unknown): ReturnType<S['parse']> {
  try {
    return schema.parse(body) as ReturnType<S['parse']>;
  } catch (err) {
    if (err instanceof ZodError) {
      throw badRequest('That request was not valid', err.issues);
    }
    throw err;
  }
}

export function errorHandler(err: unknown, _req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) {
    next(err);
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, details: err.details ?? null });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({ error: 'That request was not valid', details: err.issues });
    return;
  }
  console.error('[voku] unhandled error:', err);
  res.status(500).json({ error: 'Something went wrong on the server', details: null });
}
