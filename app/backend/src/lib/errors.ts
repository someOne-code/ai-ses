export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  public constructor(message: string, statusCode = 500, code?: string) {
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
  }
}
