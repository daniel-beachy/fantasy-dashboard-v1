export class AppError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'AppError';
  }
}

export function safeMessage(error: unknown, fallback = 'ESPN could not complete this request. Please retry or sign in again.'): string {
  return error instanceof AppError ? error.message : fallback;
}
