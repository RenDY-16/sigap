export type ApiStatus = 400 | 401 | 403 | 404 | 409 | 413 | 429 | 500 | 503;

export class ApiError extends Error {
  readonly status: ApiStatus;
  readonly code: string;

  constructor(status: ApiStatus, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
  };
}
