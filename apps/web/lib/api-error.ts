/**
 * What a non-2xx response becomes on the client.
 *
 * Lives in its own module because two repositories now need it, and having the
 * document hub import its error type from `http-event-repository` would imply a
 * relationship between the calendar and the document hub that does not exist.
 */

/** An API call that came back with a non-2xx status. */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** Best-effort message from an error response, which may not be JSON at all. */
export async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as {error?: string; message?: string};
    // Hono's HTTPException serialises as `message`; our hand-written error
    // bodies use `error`. Both are the sentence we want to show someone.
    if (body.error) {
      return body.error;
    }
    if (body.message) {
      return body.message;
    }
  } catch {
    // Fall through to the status text.
  }
  return response.statusText || `Request failed with ${response.status}`;
}
