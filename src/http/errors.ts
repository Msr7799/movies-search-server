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
    return new AppError(
      503,
      "SERVICE_NOT_CONFIGURED",
      "الخدمة غير مهيأة بالكامل على الخادم.",
    );
  }
  if (error instanceof Error && error.message === "TMDB_NOT_CONFIGURED") {
    return new AppError(
      503,
      "TMDB_NOT_CONFIGURED",
      "TMDB غير مهيأ على الخادم. أضف TMDB_API_KEY أو API_READ_AUTH_TOKEN ثم أعد النشر.",
    );
  }
  if (error instanceof Error && error.message.startsWith("TMDB_FAILED:")) {
    return new AppError(
      502,
      "TMDB_UPSTREAM_FAILURE",
      "تعذر الوصول إلى TMDB الآن. حاول مرة أخرى بعد قليل.",
    );
  }
  return new AppError(
    502,
    "UPSTREAM_FAILURE",
    "تعذر إكمال الطلب الآن. حاول مرة أخرى.",
  );
}
