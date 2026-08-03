/**
 * The public marketing segment.
 *
 * A route group, so it adds no path segment - the landing page really is `/`.
 * It sits outside `(dashboard)` deliberately: that group's layout wraps
 * everything in `AuthGuard`, and this is the one surface that must render for
 * someone with no account at all.
 *
 * A server component with no client code of its own, so the metadata below is
 * exported statically and the page is prerenderable.
 */

import type {Metadata} from 'next';

export const metadata: Metadata = {
  // Overrides the root template's "%s - COS" because this is the site's front
  // door, and "Home - COS" reads like a section of an app rather than a product.
  title: {absolute: 'COS - the connective layer for student clubs'},
  description:
    'COS connects the tools your club already runs on - GroupMe, Notion, Box, Canva - into one dashboard, and gives officers auditable spending records and a real document history. Open source, AGPL-3.0.',
};

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
