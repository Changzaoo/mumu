/** Base application error — carries a stable machine code + HTTP status. */
export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: string, message: string, status: number, details?: unknown) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource', details?: unknown) {
    super('NOT_FOUND', `${resource} not found`, 404, details);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Invalid input', details?: unknown) {
    super('VALIDATION_ERROR', message, 422, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required', details?: unknown) {
    super('UNAUTHORIZED', message, 401, details);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden', details?: unknown) {
    super('FORBIDDEN', message, 403, details);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflict', details?: unknown) {
    super('CONFLICT', message, 409, details);
  }
}

export class RateLimitError extends AppError {
  constructor(message = 'Too many requests', details?: unknown) {
    super('RATE_LIMITED', message, 429, details);
  }
}
