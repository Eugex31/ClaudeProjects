/**
 * Typed application errors and their translation to an RFC 7807-style problem
 * body. Route handlers throw an `AppError` subclass; the edge of the app calls
 * `toProblem` to turn whatever was thrown into a safe `{ status, body }`.
 *
 * The safety rule: `toProblem` only ever copies user-facing text out of an
 * `AppError.userMessage`. Anything else -- a native `Error`, a string, a Prisma
 * failure -- collapses to a generic 500 whose `detail` is a fixed string, so a
 * stack trace or a raw database message can never reach the client.
 */

export abstract class AppError extends Error {
  abstract readonly code: string;
  abstract readonly httpStatus: number;
  readonly userMessage: string;
  constructor(userMessage: string) {
    super(userMessage);
    this.userMessage = userMessage;
    this.name = this.constructor.name;
  }
}

export class ValidationError extends AppError {
  code = "validation_error";
  httpStatus = 422;
}
export class UnauthorizedError extends AppError {
  code = "unauthorized";
  httpStatus = 401;
}
export class ForbiddenError extends AppError {
  code = "forbidden";
  httpStatus = 403;
}
export class NotFoundError extends AppError {
  code = "not_found";
  httpStatus = 404;
}
export class PlanLimitError extends AppError {
  code = "plan_limit";
  httpStatus = 402;
}
export class ConflictError extends AppError {
  code = "conflict";
  httpStatus = 409;
}

const TITLES: Record<number, string> = {
  401: "Not signed in",
  402: "Plan limit reached",
  403: "Forbidden",
  404: "Not found",
  409: "Conflict",
  422: "Check your input",
  500: "Server error",
};

export interface Problem {
  status: number;
  body: { type: string; title: string; detail: string };
}

export function toProblem(err: unknown): Problem {
  if (err instanceof AppError) {
    return {
      status: err.httpStatus,
      body: {
        type: err.code,
        title: TITLES[err.httpStatus] ?? "Error",
        detail: err.userMessage,
      },
    };
  }
  return {
    status: 500,
    body: {
      type: "internal_error",
      title: TITLES[500],
      detail: "Something went wrong. Please try again.",
    },
  };
}
