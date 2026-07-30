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
  backgroundImage:
    'radial-gradient(var(--color-border-emphasized) 1px, transparent 1px)',
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
              headingHref="/"
            />
          }
        />
      }>
      {children}
    </AppShell>
  );
}
