// src/errors.ts
export type ErrorCode =
  | "INVALID_TIER"
  | "INVALID_LOCALE"
  | "NOT_FOUND"
  | "DATA_UNAVAILABLE"
  | "DATA_MALFORMED"
  | "DATA_UPSTREAM_ERROR"
  | "INTERNAL_ERROR";

const HTTP_STATUS: Record<ErrorCode, number> = {
  INVALID_TIER: 400,
  INVALID_LOCALE: 400,
  NOT_FOUND: 404,
  DATA_UNAVAILABLE: 500,
  DATA_MALFORMED: 500,
  DATA_UPSTREAM_ERROR: 500,
  INTERNAL_ERROR: 500,
};

/** An error with a stable code and a client-safe message. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.httpStatus = HTTP_STATUS[code];
  }
}

export interface StructuredError {
  error: { code: ErrorCode; message: string };
}

/** Maps any throwable to an HTTP status + structured body. Never leaks an unknown error's message. */
export function toStructuredError(err: unknown): {
  status: number;
  body: StructuredError;
} {
  if (err instanceof AppError) {
    return {
      status: err.httpStatus,
      body: { error: { code: err.code, message: err.message } },
    };
  }
  return {
    status: 500,
    body: {
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred.",
      },
    },
  };
}
