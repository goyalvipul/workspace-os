export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: { field: string; message: string }[],
    public extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found`);
export const forbidden = (msg = 'Forbidden') => new AppError(403, 'FORBIDDEN', msg);
export const unauthorized = (msg = 'Authentication required') => new AppError(401, 'UNAUTHENTICATED', msg);
export const badRequest = (msg: string, details?: { field: string; message: string }[]) =>
  new AppError(400, 'VALIDATION_ERROR', msg, details);
export const conflict = (code: string, msg: string, extra?: Record<string, unknown>) => new AppError(409, code, msg, undefined, extra);
export const versionConflict = (current: unknown, expectedVersion: number) =>
  new AppError(409, 'VERSION_CONFLICT', 'This item was changed elsewhere. Reload and try again.', undefined, { current, expectedVersion });
