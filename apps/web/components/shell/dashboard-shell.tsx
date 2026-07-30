'use client';

/**
 * The dashboard frame.
 *
 * TopNav rather than SideNav on purpose: Astryx's own guidance reserves SideNav
 * for five-plus destinations or hierarchical grouping, and phase 1 has exactly
 * one surface. When v0.2 adds the integration hub, documents, and members, this
 * is where a SideNav slots in - AppShell already has the `sideNav` slot for it.
 *
 * `contentPadding={0}` because the page below manages its own padding around a
 * full-bleed calendar grid.
 */

import type {CSSProperties} from 'react';
import {AppShell} from '@astryxdesign/core/AppShell';
import {TopNav, TopNavHeading} from '@astryxdesign/core/TopNav';
import {NavIcon} from '@astryxdesign/core/NavIcon';
import {CalendarDaysIcon} from '@heroicons/react/24/solid';
import {DEMO_CLUB_NAME} from '../../lib/seed-events';
import {RoleSwitcher} from './role-switcher';

/**
 * The Notion-style dot grid. It sits on the shell background, behind the
 * calendar surface, so the grid reads as the workspace the calendar floats on
 * rather than as texture inside the calendar itself.
 */
const dottedWorkspace: CSSProperties = {
  height: '100%',
  minHeight: 0,
  backgroundImage:
    'radial-gradient(var(--color-border-emphasized) 1px, transparent 1px)',
  backgroundSize: 'var(--spacing-6) var(--spacing-6)',
  backgroundPosition: '-1px -1px',
};

export function DashboardShell({children}: {children: React.ReactNode}) {
  return (
    <AppShell
      contentPadding={0}
      variant="section"
      style={dottedWorkspace}
      topNav={
        <TopNav
          label="COS navigation"
          heading={
            <TopNavHeading
              logo={
                <NavIcon
                  icon={<CalendarDaysIcon style={{width: 16, height: 16}} />}
                />
              }
              heading="COS"
              subheading={DEMO_CLUB_NAME}
              headingHref="/"
            />
          }
          endContent={<RoleSwitcher />}
        />
      }>
      {children}
    </AppShell>
  );
}
