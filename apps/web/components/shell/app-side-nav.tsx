'use client';

/**
 * The dashboard's primary navigation.
 *
 * This deliberately reverses the earlier "TopNav only" decision. Astryx
 * reserves SideNav for five-plus destinations and there are two, but the
 * threshold is about whether a flat top nav can still express the product's
 * shape, and it no longer can: calendar and treasury are different jobs a club
 * does, not two tabs of one surface. Sections make that division visible from
 * the first screen instead of implying the calendar is the whole product.
 *
 * No SideNavHeading here on purpose. TopNav already carries the COS mark and
 * the club name, and Astryx's guidance is not to duplicate app identity across
 * both.
 *
 * Icons are paired outline/filled so the selected item is distinguishable
 * without relying on the background tint alone.
 *
 * `collapsible` is not decoration. The calendar already gives 340px to a fixed
 * context panel, so on a narrow laptop the sidebar is the difference between
 * day cells that show an event's title and day cells that show only its time.
 * Collapsing hands that width back.
 */

import type {CSSProperties} from 'react';
import NextLink from 'next/link';
import {usePathname} from 'next/navigation';
import type {Capability} from '@cos/core';
import {
  SideNav,
  SideNavCollapseButton,
  SideNavItem,
  SideNavSection,
} from '@astryxdesign/core/SideNav';
import {IconButton} from '@astryxdesign/core/IconButton';
import {HStack, VStack} from '@astryxdesign/core/Stack';
import {Text} from '@astryxdesign/core/Text';
import {
  BanknotesIcon,
  CalendarDaysIcon,
  Cog6ToothIcon,
} from '@heroicons/react/24/outline';
import {
  BanknotesIcon as BanknotesIconSolid,
  CalendarDaysIcon as CalendarDaysIconSolid,
  Cog6ToothIcon as Cog6ToothIconSolid,
} from '@heroicons/react/24/solid';

import {useSession} from '../../lib/session';
import styles from './settings-button.module.css';

/**
 * SideNav renders transparent by default, and the shell paints a dot grid
 * behind the whole frame, so without this the navigation items float on the
 * canvas and the sidebar reads as unfinished. Same fix already applied to the
 * calendar's context panel: chrome gets a surface, only content sits on the
 * grid.
 */
const sideNavSurface: CSSProperties = {
  backgroundColor: 'var(--color-background-surface)',
};

/**
 * Navigation is data rather than hand-written JSX so that adding a destination
 * is one entry, and so the active-route rule below is applied identically to
 * every item instead of being repeated per link.
 *
 * A section may declare a `capability`. When it does, the whole group is
 * hidden from anyone who lacks it - members do not see an Officers heading
 * with nothing under it, which would advertise the existence of a section they
 * cannot open. Adding an officer-only surface is one entry in this group.
 *
 * Hiding navigation is not a security control. It decides what to render; the
 * API refuses the request regardless of what the browser drew.
 */
const SECTIONS: readonly {
  title: string;
  capability?: Capability;
  items: readonly {
    href: string;
    label: string;
    icon: typeof CalendarDaysIcon;
    selectedIcon: typeof CalendarDaysIconSolid;
  }[];
}[] = [
  {
    title: 'Club',
    items: [
      {
        href: '/calendar',
        label: 'Calendar',
        icon: CalendarDaysIcon,
        selectedIcon: CalendarDaysIconSolid,
      },
    ],
  },
  {
    title: 'Treasury',
    capability: 'expense:view',
    items: [
      {
        href: '/expenses',
        label: 'Expenses',
        icon: BanknotesIcon,
        selectedIcon: BanknotesIconSolid,
      },
    ],
  },
];

const headerRow: CSSProperties = {
  paddingInline: 'var(--spacing-2)',
  paddingBlock: 'var(--spacing-2)',
};

const footerBlock: CSSProperties = {
  paddingInline: 'var(--spacing-3)',
  paddingBlock: 'var(--spacing-3)',
  minWidth: 0,
};

/**
 * Who you are, at the foot of the sidebar.
 *
 * Title above name, with the settings control on the name's row. The title
 * goes on its own line rather than beside the name because "Marketing
 * Director" next to a full name does not fit a 260px rail without one of them
 * truncating, and the title is the part that answers "who do I ask about
 * this".
 *
 * Both are plain text, deliberately. This block used to open a dropdown for
 * sign-out and club switching; that menu covered the title it was anchored to
 * and read as bolted on. Those actions moved to Settings, which is where
 * account actions belong and which is one click away via the gear beside the
 * name. The footer is now purely "this is who you are signed in as", and
 * because nothing here is a button, the title and the name share the same
 * left edge instead of the name being inset by a button's padding.
 *
 * Settings sits here rather than in the nav list above because it is not a
 * destination of the same kind: the list is what the club does, this is about
 * the person using it.
 */
function SideNavIdentity() {
  const {user, title} = useSession();
  const pathname = usePathname();

  if (!user) {
    return null;
  }

  return (
    <VStack gap={0} style={footerBlock} hAlign="stretch">
      {title ? (
        <Text type="supporting" color="secondary" display="block">
          {title}
        </Text>
      ) : null}
      <HStack gap={2} vAlign="center" hAlign="between">
        <Text type="body" weight="semibold" display="block">
          {user.name}
        </Text>
        <IconButton
          label="Settings"
          className={styles.settingsButton}
          icon={
            isActive(pathname, '/settings') ? (
              <Cog6ToothIconSolid />
            ) : (
              <Cog6ToothIcon />
            )
          }
          variant="ghost"
          size="sm"
          as={NextLink}
          href="/settings"
        />
      </HStack>
    </VStack>
  );
}

/**
 * Matches the item's own route and anything nested beneath it, so a future
 * `/expenses/:id` detail page still highlights Expenses rather than clearing
 * the selection.
 */
function isActive(pathname: string | null, href: string): boolean {
  if (!pathname) {
    return false;
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppSideNav() {
  const pathname = usePathname();
  const {activeClub} = useSession();

  // Read the expanded capability list rather than calling `useCan` per section:
  // a hook inside a loop is fragile the moment the list stops being static, and
  // the server already flattened the role into exactly this array.
  const capabilities = activeClub?.capabilities ?? [];
  const sections = SECTIONS.filter(
    (section) =>
      section.capability === undefined ||
      capabilities.includes(section.capability),
  );

  return (
    <SideNav
      style={sideNavSurface}
      // The built-in toggle sits at the bottom, where the identity block now
      // lives. Suppressing it and placing the button in the header puts it top
      // right, clear of the footer.
      collapsible={{hasButton: false}}
      header={
        <HStack hAlign="end" vAlign="center" style={headerRow}>
          <SideNavCollapseButton />
        </HStack>
      }
      footer={<SideNavIdentity />}>
      {sections.map((section) => (
        <SideNavSection key={section.title} title={section.title}>
          {section.items.map((item) => (
            <SideNavItem
              key={item.href}
              as={NextLink}
              href={item.href}
              label={item.label}
              icon={item.icon}
              selectedIcon={item.selectedIcon}
              isSelected={isActive(pathname, item.href)}
            />
          ))}
        </SideNavSection>
      ))}
    </SideNav>
  );
}
