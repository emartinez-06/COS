/**
 * The better-auth browser client.
 *
 * Points at services/api rather than at a Next route handler, because the
 * repo rule is that apps talk to services only over the API. In development
 * that means a different port, which is why every call is credentialed and
 * why the API names this origin in WEB_ORIGINS.
 */

import {createAuthClient} from 'better-auth/react';

/**
 * Where the API lives. Public because the browser has to reach it; there is
 * nothing secret in an origin.
 */
export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3200';

export const authClient = createAuthClient({
  baseURL: API_URL,
  basePath: '/api/auth',
  fetchOptions: {
    // The session is an httpOnly cookie, so it only travels if cross-origin
    // requests are told to carry credentials.
    credentials: 'include',
  },
});

export const {signIn, signOut, signUp, useSession: useAuthSession} = authClient;

/**
 * Calls a COS API route with the session cookie attached.
 *
 * Thin on purpose: this exists so no component has to remember
 * `credentials: 'include'`, which fails silently and confusingly when omitted.
 *
 * The JSON content type is skipped for a `FormData` body, and that is not a
 * tidiness choice. A multipart request's content type carries the boundary
 * that separates its parts, and only the browser knows what boundary it is
 * about to generate. Declaring `application/json` over a `FormData` body sends
 * a request the server cannot parse at all - the document hub's uploads are
 * the reason this branch exists.
 */
export async function apiFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const isMultipart =
    typeof FormData !== 'undefined' && init.body instanceof FormData;

  return fetch(`${API_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      ...(isMultipart ? {} : {'Content-Type': 'application/json'}),
      ...init.headers,
    },
  });
}
