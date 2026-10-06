export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly retryAfter?: number,
  ) {
    super(message);
  }
}

export function publicError(error: unknown) {
  if (error instanceof AppError) return error;
  if (error instanceof Error && error.message.startsWith("MISSING_ENV:")) {
    return new AppError(503, "SERVICE_NOT_CONFIGURED", "الخدمة غير مهيأة بالكامل على الخادم.");
  }
  return new AppError(502, "UPSTREAM_FAILURE", "تعذر إكمال الطلب الآن. حاول مرة أخرى.");
}
