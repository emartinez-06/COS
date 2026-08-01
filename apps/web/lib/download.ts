/**
 * Saving bytes the app already has to the reader's disk.
 *
 * Worth stating why the hub does not simply point an `<a href>` at the API's
 * download route, which would be less code:
 *
 * - The route is on another origin in development and requires the session
 *   cookie. A plain navigation is at the mercy of the cookie's SameSite policy
 *   and of whatever the browser decides to do with a cross-origin download.
 * - A failed navigation renders the API's JSON error as a page. Fetching means
 *   a 403 is a sentence on the document's own screen instead of `{"error":…}`
 *   in a new tab.
 * - It goes through `DocumentRepository.download`, so the hub has exactly one
 *   way of getting a document's bytes.
 */

/** Hands a blob to the browser's downloader under `fileName`. */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Revoked on the next tick rather than immediately: some browsers have not
  // started reading the object URL by the time `click()` returns, and revoking
  // it first produces a download that fails with no message.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
