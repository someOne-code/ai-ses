export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details: unknown;

  public constructor(
    message: string,
    statusCode = 500,
    code?: string,
    details?: unknown
  ) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code =
      code ??
      (statusCode === 400
        ? "VALIDATION_ERROR"
        : statusCode === 404
          ? "NOT_FOUND"
        : statusCode >= 500
            ? "INTERNAL_ERROR"
            : "REQUEST_ERROR");
    this.details = details;
  }
}
