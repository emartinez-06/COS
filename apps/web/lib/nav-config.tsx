'use client';

/**
 * The dashboard's navigation, as data.
 *
 * This used to live inside `app-side-nav.tsx`. It moved here when search
 * arrived, and the reason is worth stating: search indexes *this*, so the
 * sidebar and the palette cannot drift apart. A hand-curated search index is a
 * second list of the product's destinations, and the failure mode is silent -
 * someone adds a surface, forgets the index, and it is simply unfindable for
 * however long it takes a person to notice.
 *
 * `keywords` exist only for search. They carry the words someone would
 * actually type when they do not know what this product calls a thing -
 * "budget" for the treasury, "bylaws" for documents - and they are never
 * rendered.
 */

import type {Capability} from '@cos/core';
import {
  BanknotesIcon,
  CalendarDaysIcon,
  Cog6ToothIcon,
  FolderIcon,
  Squares2X2Icon,
} from '@heroicons/react/24/outline';
import {
  BanknotesIcon as BanknotesIconSolid,
  CalendarDaysIcon as CalendarDaysIconSolid,
  Cog6ToothIcon as Cog6ToothIconSolid,
  FolderIcon as FolderIconSolid,
  Squares2X2Icon as Squares2X2IconSolid,
} from '@heroicons/react/24/solid';

export interface NavItem {
  href: string;
  label: string;
  capability?: Capability;
  icon: typeof CalendarDaysIcon;
  selectedIcon: typeof CalendarDaysIconSolid;
  /** Search-only synonyms. Never rendered. */
  keywords?: readonly string[];
  /**
   * Reachable from the sidebar. Settings' sub-sections are real destinations
   * and belong in search, but the rail lists what the club does, not every
   * screen that exists.
   */
  isInSideNav?: boolean;
}

export interface NavSection {
  title: string;
  capability?: Capability;
  items: readonly NavItem[];
}

/**
 * A section may declare a `capability`, hiding the whole group from anyone
 * without it - members do not see a Treasury heading with nothing under it. An
 * item may declare its own for the case a group does not cover.
 *
 * Hiding navigation is not a security control. It decides what to render; the
 * API refuses the request regardless of what the browser drew. The same is
 * true of search: `visibleNav` filters the index so a member is not offered a
 * result they would be refused, but the refusal is the API's.
 */
export const NAV_SECTIONS: readonly NavSection[] = [
  {
    title: 'Overview',
    items: [
      {
        href: '/home',
        label: 'Dashboard',
        icon: Squares2X2Icon,
        selectedIcon: Squares2X2IconSolid,
        keywords: ['home', 'overview', 'summary', 'start'],
        isInSideNav: true,
      },
    ],
  },
  {
    title: 'Club',
    items: [
      {
        href: '/calendar',
        label: 'Calendar',
        icon: CalendarDaysIcon,
        selectedIcon: CalendarDaysIconSolid,
        keywords: ['events', 'schedule', 'meeting', 'agenda', 'month'],
        isInSideNav: true,
      },
      {
        href: '/documents',
        label: 'Documents',
        // Every role holds this, so unlike the treasury the hub is in
        // everyone's sidebar. What officers get is the drafts and the editor,
        // not the section itself.
        capability: 'document:view',
        icon: FolderIcon,
        selectedIcon: FolderIconSolid,
        keywords: ['files', 'bylaws', 'constitution', 'notes', 'records'],
        isInSideNav: true,
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
        keywords: ['money', 'budget', 'fund', 'spending', 'reimburse'],
        isInSideNav: true,
      },
    ],
  },
  {
    title: 'Settings',
    items: [
      {
        href: '/settings?section=profile',
        label: 'Your profile',
        icon: Cog6ToothIcon,
        selectedIcon: Cog6ToothIconSolid,
        keywords: ['account', 'name', 'email', 'sign out', 'log out'],
      },
      {
        href: '/settings?section=availability',
        label: 'Availability',
        icon: Cog6ToothIcon,
        selectedIcon: Cog6ToothIconSolid,
        keywords: ['status', 'presence', 'do not disturb', 'dnd', 'idle', 'away', 'online'],
      },
      {
        href: '/settings?section=club',
        label: 'Club settings',
        icon: Cog6ToothIcon,
        selectedIcon: Cog6ToothIconSolid,
        keywords: ['switch club', 'rename'],
      },
      {
        href: '/settings?section=members',
        label: 'Members',
        icon: Cog6ToothIcon,
        selectedIcon: Cog6ToothIconSolid,
        keywords: ['invite', 'roster', 'people', 'officers'],
      },
      {
        href: '/settings?section=shortcuts',
        label: 'Keyboard shortcuts',
        icon: Cog6ToothIcon,
        selectedIcon: Cog6ToothIconSolid,
        keywords: ['hotkey', 'search shortcut', 'keybinding', 'customise'],
      },
    ],
  },
];

/**
 * The sections a given capability set may see, with items filtered and any
 * section left empty dropped - an empty heading is exactly what the
 * section-level gate exists to avoid.
 */
export function visibleNav(
  capabilities: readonly Capability[],
): NavSection[] {
  const held = (capability: Capability | undefined) =>
    capability === undefined || capabilities.includes(capability);

  return NAV_SECTIONS.filter((section) => held(section.capability))
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => held(item.capability)),
    }))
    .filter((section) => section.items.length > 0);
}
