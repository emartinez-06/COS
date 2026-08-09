'use client';

/**
 * The dashboard frame.
 *
 * TopNav owns the product mark and the club name. SideNav owns destinations
 * *and* the person: their title, name, and settings sit in its footer, which
 * is where a workspace app puts them and where there is room for a full job
 * title without truncating it against a name.
 *
 * TopNav therefore has no end content. It stays because the COS mark and the
 * club name still need somewhere to live, and because SideNav's own heading
 * would duplicate exactly that.
 *
 * `contentPadding={0}` because the page below manages its own padding - the
 * calendar grid is full-bleed and the treasury pages are not.
 */

import type {CSSProperties} from 'react';
import {AppShell} from '@astryxdesign/core/AppShell';
import {TopNav, TopNavHeading} from '@astryxdesign/core/TopNav';
import {NavIcon} from '@astryxdesign/core/NavIcon';
import {CalendarDaysIcon} from '@heroicons/react/24/solid';
import {useSession} from '../../lib/session';
import {AppSideNav} from './app-side-nav';
import {SearchTrigger} from './search-trigger';
import {SiteSearchPalette} from './site-search-palette';

/**
 * The Notion-style dot grid. It sits on the shell background, behind the
 * calendar surface, so the grid reads as the workspace the calendar floats on
 * rather than as texture inside the calendar itself.
 */
const dottedWorkspace: CSSProperties = {
  // No `height` here. AppShell defaults to height="fill" (100dvh) and manages
  // its own scroll containers; an inline `height: 100%` resolves against the
  // body instead and collapses the shell to content height, which leaves a
  // band of unpainted background below the fold on a tall window.
  minHeight: 0,
  // `--color-border`, not `--color-border-emphasized`. The grid is decorative
  // texture, and Astryx 0.3.0 gave the emphasized token a contrast contract -
  // it is now generated so it clears 3:1 against the surface for non-text UI.
  // That is the right guarantee for a real border and the wrong one here: the
  // upgrade darkened it from #A8ABB9 to #8D909E and the dots started reading
  // as content rather than as the surface they sit under. A texture wants to
  // be below that threshold deliberately. This token is also alpha-based
  // (10% ink), so it composites over whatever ground it lands on instead of
  // assuming one.
  backgroundImage: 'radial-gradient(var(--color-border) 1px, transparent 1px)',
  backgroundSize: 'var(--spacing-6) var(--spacing-6)',
  backgroundPosition: '-1px -1px',
};

/**
 * Nav chrome gets an opaque surface so the dot grid stops behind it.
 *
 * Both nav regions render transparent by default and the grid is painted on
 * the shell root, so without this the club name and the user menu sit directly
 * on the canvas. The grid is meant to read as the surface content floats on,
 * which only works if the chrome framing it is solid.
 */
const navSurface: CSSProperties = {
  backgroundColor: 'var(--color-background-surface)',
};

export function DashboardShell({children}: {children: React.ReactNode}) {
  const {activeClub} = useSession();

  return (
    <AppShell
      contentPadding={0}
      variant="section"
      style={dottedWorkspace}
      sideNav={<AppSideNav />}
      topNav={
        <TopNav
          label="COS navigation"
          style={navSurface}
          heading={
            <TopNavHeading
              logo={
                <NavIcon
                  icon={<CalendarDaysIcon style={{width: 16, height: 16}} />}
                />
              }
              heading="COS"
              subheading={activeClub?.name}
              // The dashboard, not `/`. Inside the shell the reader is signed
              // in by definition, and a product mark that throws them out to
              // the marketing page is the one link here that leaves the app.
              headingHref="/home"
            />
          }
          // TopNav had no end content deliberately - identity moved to the
          // sidebar's footer. Search is the one thing that earns a place back:
          // it is global rather than about the person, it belongs at the top
          // of every surface, and putting it in the rail would hide it
          // whenever the rail is collapsed.
          endContent={<SearchTrigger />}
        />
      }>
      {/*
        Mounted once, here, rather than per page: the shortcut is global, and a
        palette per surface would bind the same key several times over.
      */}
      <SiteSearchPalette />
      {children}
    </AppShell>
  );
}
