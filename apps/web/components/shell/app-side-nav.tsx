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
 *
 * The collapse control shares the first section's heading row rather than
 * having a band of its own. It used to sit in a `header` slot, which spent a
 * 64px strip across the full width of the rail on one 32px button - 204px of
 * it empty - and pushed the first heading down with it. Riding on the heading
 * line costs no vertical space at all, and puts the control on the top line of
 * the thing it collapses.
 */

import {useState, type CSSProperties} from 'react';
import NextLink from 'next/link';
import {usePathname} from 'next/navigation';
import type {Capability} from '@cos/core';
import {SideNav, SideNavItem, SideNavSection} from '@astryxdesign/core/SideNav';
import {IconButton} from '@astryxdesign/core/IconButton';
import {HStack, VStack} from '@astryxdesign/core/Stack';
import {Text} from '@astryxdesign/core/Text';
import {
  BanknotesIcon,
  CalendarDaysIcon,
  ChevronLeftIcon,
  Cog6ToothIcon,
  FolderIcon,
} from '@heroicons/react/24/outline';
import {
  BanknotesIcon as BanknotesIconSolid,
  CalendarDaysIcon as CalendarDaysIconSolid,
  Cog6ToothIcon as Cog6ToothIconSolid,
  FolderIcon as FolderIconSolid,
} from '@heroicons/react/24/solid';

import {useSession} from '../../lib/session';
import styles from './settings-button.module.css';
import collapseStyles from './collapse-button.module.css';
import sideNavStyles from './side-nav.module.css';

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
 * An individual item may declare one too, for the case a group does not cover:
 * a section every member can see that contains one destination not everyone
 * can. Documents is deliberately written this way even though `document:view`
 * is held by every role, so the gate that governs the surface is stated next to
 * the link to it rather than left implicit.
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
    capability?: Capability;
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
      {
        href: '/documents',
        label: 'Documents',
        // Every role holds this, so unlike the treasury below, the hub is in
        // everyone's sidebar. What officers get is the drafts and the editor,
        // not the section itself.
        capability: 'document:view',
        icon: FolderIcon,
        selectedIcon: FolderIconSolid,
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

const footerBlock: CSSProperties = {
  paddingInline: 'var(--spacing-3)',
  paddingBlock: 'var(--spacing-3)',
  minWidth: 0,
};

/**
 * The collapsed rail is 48px wide, so the lone expand button is centred in it
 * rather than left-aligned against an edge that is no longer there.
 */
const collapsedToggleRow: CSSProperties = {
  paddingBlock: 'var(--spacing-2)',
};

/**
 * The sidebar's own collapse toggle.
 *
 * One chevron that rotates rather than two icons that swap - see the CSS
 * module. The accessible label names the *action* and changes with the state,
 * so it says what pressing it will do rather than what it is, and
 * `aria-expanded` carries the state itself.
 */
function CollapseToggle({
  isCollapsed,
  onToggle,
}: {
  isCollapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <IconButton
      label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      className={[
        collapseStyles.collapseButton,
        isCollapsed ? collapseStyles.collapseButtonCollapsed : '',
      ]
        .filter(Boolean)
        .join(' ')}
      icon={<ChevronLeftIcon />}
      variant="ghost"
      size="sm"
      aria-expanded={!isCollapsed}
      onClick={onToggle}
    />
  );
}

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
 *
 * Collapsed, the words go and the gear stays, centred like the nav icons above
 * it. The rail is 48px and a name is not; left as it was, "Jordan Treasurer"
 * wrapped into a clipped stack of three-letter fragments and pushed the gear
 * off the rail entirely, so the one control down here became unreachable in
 * the state that most needs it to be small. The name is the part a collapsed
 * rail can afford to drop - it says who you are, which you already know, while
 * the gear is the only way out of this corner of the app.
 */
function SideNavIdentity({isCollapsed}: {isCollapsed: boolean}) {
  const {user, title} = useSession();
  const pathname = usePathname();

  if (!user) {
    return null;
  }

  const settingsButton = (
    <IconButton
      // Collapsed, this is the only thing left of the identity block, so the
      // label carries the name the text no longer shows.
      label={isCollapsed ? `Settings - signed in as ${user.name}` : 'Settings'}
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
  );

  if (isCollapsed) {
    return (
      <HStack hAlign="center" style={collapsedToggleRow}>
        {settingsButton}
      </HStack>
    );
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
        {settingsButton}
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
  const [isCollapsed, setCollapsed] = useState(false);

  // Read the expanded capability list rather than calling `useCan` per section:
  // a hook inside a loop is fragile the moment the list stops being static, and
  // the server already flattened the role into exactly this array.
  const capabilities = activeClub?.capabilities ?? [];
  const held = (capability: Capability | undefined) =>
    capability === undefined || capabilities.includes(capability);

  const sections = SECTIONS.filter((section) => held(section.capability))
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => held(item.capability)),
    }))
    // A section whose every item was filtered out is a heading with nothing
    // under it, which is the thing the section-level gate exists to avoid.
    .filter((section) => section.items.length > 0);

  return (
    <SideNav
      style={sideNavSurface}
      className={sideNavStyles.rail}
      // The built-in toggle renders at the bottom, where the identity block
      // now lives. It stays suppressed; ours rides the first heading instead.
      //
      // Controlled rather than uncontrolled because the toggle moves between
      // two slots depending on the state, so both have to read from the same
      // place. Drag-to-collapse still works - SideNav reports it through this
      // same callback, so the chevron follows a drag it did not cause.
      collapsible={{
        hasButton: false,
        isCollapsed,
        onCollapsedChange: setCollapsed,
      }}
      // Collapsing hides every section header, and `endContent` goes with it -
      // the library clips the whole header to a 1x1 box. Left there, the
      // control would be a one-way door: collapse once and there is nothing
      // left to click. `topContent` is the one slot that survives, so the
      // button moves here for exactly as long as the heading it normally
      // rides is unavailable.
      topContent={
        isCollapsed ? (
          <HStack hAlign="center" style={collapsedToggleRow}>
            <CollapseToggle
              isCollapsed
              onToggle={() => setCollapsed((collapsed) => !collapsed)}
            />
          </HStack>
        ) : undefined
      }
      footer={<SideNavIdentity isCollapsed={isCollapsed} />}>
      {sections.map((section, index) => (
        <SideNavSection
          key={section.title}
          title={section.title}
          // On the first section only: the toggle sits at the right end of the
          // top heading line, which is the top line of the sidebar itself.
          endContent={
            index === 0 && !isCollapsed ? (
              <CollapseToggle
                isCollapsed={false}
                onToggle={() => setCollapsed((collapsed) => !collapsed)}
              />
            ) : undefined
          }>
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
