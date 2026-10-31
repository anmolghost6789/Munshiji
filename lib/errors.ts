/** An error meant for the user: a clear message and the right HTTP status. */
export class AppError extends Error {
  constructor(public status: number, message: string, public code = "error", public details?: unknown) { super(message); }
}
export const badRequest = (m: string, details?: unknown) => new AppError(400, m, "invalid", details);
export const forbidden = (m = "You don't have permission to do this.") => new AppError(403, m, "forbidden");
export const notFound = (m = "Not found.") => new AppError(404, m, "not_found");
export const conflict = (m: string, details?: unknown) => new AppError(409, m, "conflict", details);
