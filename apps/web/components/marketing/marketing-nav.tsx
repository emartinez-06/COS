'use client';

/**
 * The marketing site's top bar and footer.
 *
 * **Why this does not redirect a signed-in visitor to the dashboard**, which
 * was the original intent for `/`: the session is an httpOnly cookie issued by
 * `services/api` on its own origin (port 3200 in development), and the web app
 * runs on another (3100). Next middleware executes on the web origin, so it
 * cannot read that cookie, and there is no way to answer "is this person signed
 * in" on the server without a round trip to the API on every visit to the home
 * page.
 *
 * A client-side redirect would work but costs a flash of the landing page for
 * every signed-in visitor - the exact defect class this codebase has fixed
 * twice already (the `CapabilityGuard` refusal flash, and the server-side
 * redirect in the old `app/page.tsx`, which existed so there was "no flash of
 * an empty dashboard before the route changes").
 *
 * So the page stays public for everyone and the *call to action* adapts
 * instead: "Open dashboard" when there is a session, "Sign in" when there is
 * not. That is also what most products do - someone signed in who followed a
 * link to the marketing page usually meant to read it.
 */

import NextLink from 'next/link';
import {useEffect, useState, type CSSProperties} from 'react';
import {Link} from '@astryxdesign/core/Link';
import {HStack} from '@astryxdesign/core/Stack';
import {Text} from '@astryxdesign/core/Text';

import {useSession} from '../../lib/session';
import styles from './marketing.module.css';

export function MarketingNav() {
  const {status} = useSession();
  const [hasScrolled, setHasScrolled] = useState(false);

  /**
   * The hairline under the bar appears only once the page has moved, so the
   * hero reads as one uninterrupted surface at rest.
   */
  useEffect(() => {
    const onScroll = () => setHasScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, {passive: true});
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <HStack
      as="header"
      /**
       * The navigation is part of the intro and arrives after the wall has
       * built and the copy has opened, and it comes **down** from off-screen
       * while the copy rises. Leaving it visible while the bricks fell made the
       * entrance look like a page that had failed to load its middle rather
       * than one assembling itself in order.
       */
      className={`${styles.nav} ${styles.introDown} ${hasScrolled ? styles.navScrolled : ''}`}
      style={{'--mk-intro-delay': '1600ms'} as CSSProperties}
    >
      <HStack
        className={styles.navInner}
        align="center"
        justify="between"
        gap={4}
      >
        <Link as={NextLink} href="/" className={styles.wordmark}>
          COS
        </Link>

        <HStack align="center" gap={2}>
          {/*
            Nothing renders while the session resolves. Showing "Sign in" and
            swapping it to "Open dashboard" a moment later is the same flash,
            just smaller.
          */}
          {status === 'authenticated' && (
            <Link
              as={NextLink}
              href="/home"
              className={`${styles.cta} ${styles.ctaPrimary}`}
            >
              Open dashboard
            </Link>
          )}

          {status === 'anonymous' && (
            <>
              <Link
                as={NextLink}
                href="/login"
                className={`${styles.cta} ${styles.ctaSecondary}`}
              >
                Sign in
              </Link>
              <Link
                as={NextLink}
                href="/signup"
                className={`${styles.cta} ${styles.ctaPrimary}`}
              >
                Get started
              </Link>
            </>
          )}
        </HStack>
      </HStack>
    </HStack>
  );
}

/**
 * The site footer.
 *
 * Kept honest about status: the README badges this project "early
 * development", so the footer says so rather than implying a finished service.
 */
export function MarketingFooter() {
  return (
    <HStack
      as="footer"
      className={`${styles.band} ${styles.bandInk} ${styles.bandTight}`}
    >
      <HStack
        className={styles.navInner}
        align="center"
        justify="between"
        gap={4}
        wrap="wrap"
      >
        <Text
          type="supporting"
          style={{color: 'var(--cos-mk-text-invert-muted)'}}
        >
          COS - an open-source connective layer for student clubs. AGPL-3.0,
          and in early development.
        </Text>
        <HStack gap={4} wrap="wrap">
          <Link
            href="https://github.com/emartinez-06/COS"
            className={styles.footerLink}
            isExternalLink
          >
            GitHub
          </Link>
          <Link as={NextLink} href="/login" className={styles.footerLink}>
            Sign in
          </Link>
        </HStack>
      </HStack>
    </HStack>
  );
}
