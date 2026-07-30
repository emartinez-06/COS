/**
 * The dashboard root redirects to the calendar.
 *
 * The calendar is the club's home surface, but it is no longer the only one,
 * so it gets a real route rather than squatting on `/`. Redirecting here keeps
 * every existing link to `/` working - including TopNav's own heading.
 *
 * A server component on purpose: this resolves before any client bundle runs,
 * so there is no flash of an empty dashboard before the route changes.
 */

import {redirect} from 'next/navigation';

export default function HomePage() {
  redirect('/calendar');
}
