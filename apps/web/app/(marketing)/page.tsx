/**
 * `/` - the landing page.
 *
 * This replaces the old `app/page.tsx`, which was a server-side
 * `redirect('/calendar')`. That redirect existed when the dashboard was the
 * whole product and `/` had nothing else to be; now it has something to be.
 *
 * Signed-in visitors are **not** redirected away, and `marketing-nav.tsx`
 * documents why: the session cookie belongs to the API's origin, so the web
 * origin's middleware cannot read it, and a client-side redirect would flash
 * the landing page at everyone who is already signed in. The nav adapts its
 * call to action instead.
 */

import {LandingView} from '../../components/marketing/landing-view';

export default function LandingPage() {
  return <LandingView />;
}
