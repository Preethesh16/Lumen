import type { NextFunction, Request, Response } from 'express';
import type { ApiError } from '@lumen/shared-types';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const notFound = (message: string): HttpError =>
  new HttpError(404, 'not_found', message);

export const badRequest = (message: string): HttpError =>
  new HttpError(400, 'bad_request', message);

export const unauthorized = (message: string): HttpError =>
  new HttpError(401, 'unauthorized', message);

/**
 * Wraps an async handler so a rejected promise reaches the error middleware.
 * Express 5 forwards rejections automatically, but being explicit keeps the
 * behaviour obvious to anyone reading a route.
 */
export function asyncHandler<T extends Request>(
  fn: (req: T, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: T, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof HttpError) {
    const body: ApiError = { error: { code: err.code, message: err.message } };
    res.status(err.status).json(body);
    return;
  }

  // Unexpected failures are logged in full but never echoed to the client —
  // a stack trace or a driver message can leak connection strings.
  console.error('Unhandled error:', err);
  const body: ApiError = {
    error: { code: 'internal_error', message: 'An unexpected error occurred.' },
  };
  res.status(500).json(body);
}
