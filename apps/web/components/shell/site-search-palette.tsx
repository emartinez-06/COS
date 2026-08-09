'use client';

/**
 * The product's search, as a command palette.
 *
 * Opens on Cmd/Ctrl+K, on a second combination the user can rebind (default
 * Option/Alt+S), or from the top bar's search box. Cmd+K is hardcoded and
 * always works: it is what every product this audience uses already binds, and
 * it is the escape hatch for someone who rebound the other one and forgot.
 *
 * Both tiers are searched **in memory**, with no request per keystroke. The
 * club's records are fetched once, lazily, on the first open and kept for the
 * session. That is affordable precisely because of the scale this product is
 * built for - a semester of events and a handful of documents - and it is the
 * same reasoning that already justifies folding the treasury's balance on the
 * client rather than adding a summary endpoint.
 *
 * The consequence to know about: records go stale within a session. Something
 * created in another tab after the palette's first open will not be findable
 * until reload. That is the honest trade for instant results and no debounce,
 * and it is the reason the fetch is redone whenever the active club changes.
 */

import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {useRouter} from 'next/navigation';
import {
  CommandPalette,
  CommandPaletteInput,
  useCommandPaletteContext,
} from '@astryxdesign/core/CommandPalette';
import {HStack, VStack} from '@astryxdesign/core/Stack';
import {Text} from '@astryxdesign/core/Text';
import type {SearchableItem} from '@astryxdesign/core/Typeahead';

import {HttpDocumentRepository} from '../../lib/http-document-repository';
import {HttpEventRepository} from '../../lib/http-event-repository';
import {HttpTreasuryRepository} from '../../lib/http-treasury-repository';
import {OPEN_SEARCH_EVENT} from '../../lib/command-palette-bus';
import {visibleNav} from '../../lib/nav-config';
import {
  placeKey,
  recordKey,
  searchSite,
  type PlaceInput,
  type RecordInput,
  type SearchResult,
} from '../../lib/site-search';
import {
  SEARCH_SHORTCUT_CHANGE_EVENT,
  matchesShortcut,
  searchShortcutStore,
} from '../../lib/shortcut-store';
import {useSession} from '../../lib/session';

interface ItemData {
  group: string;
  sublabel?: string;
  href: string;
}

/**
 * Highlights the first result whenever the list changes and nothing is
 * highlighted.
 *
 * Astryx's palette starts with `highlightedIndex` at -1, and its Enter handler
 * returns early when nothing is highlighted - so out of the box, typing a
 * query and pressing Enter does nothing at all until you have pressed
 * ArrowDown once. That is not how any palette people already use behaves, and
 * the failure is silent: the key appears not to work rather than telling you
 * to pick something.
 *
 * It rides in the `input` slot because that slot is inside the palette's
 * provider, which is the only place the context is reachable. It renders the
 * stock input unchanged; the effect is the entire point of the wrapper.
 *
 * Only ever moves the highlight *off* -1, so it cannot fight the arrow keys
 * once someone is navigating.
 */
function AutoHighlightInput() {
  // Typed nullable because the hook is reachable outside a palette. It never
  // is here - this only renders in the `input` slot - so the guard is for the
  // compiler rather than a case that can happen.
  const palette = useCommandPaletteContext();
  const highlightedIndex = palette?.highlightedIndex ?? -1;
  const setHighlightedIndex = palette?.setHighlightedIndex;
  const itemCount = palette?.selectableItems.length ?? 0;

  useEffect(() => {
    if (itemCount > 0 && highlightedIndex < 0) {
      setHighlightedIndex?.(0);
    }
  }, [itemCount, highlightedIndex, setHighlightedIndex]);

  return <CommandPaletteInput />;
}

export function SiteSearchPalette() {
  const router = useRouter();
  const {activeClub} = useSession();
  const clubId = activeClub?.clubId ?? null;
  const capabilities = useMemo(
    () => activeClub?.capabilities ?? [],
    [activeClub],
  );

  const [isOpen, setOpen] = useState(false);
  const [records, setRecords] = useState<RecordInput[]>([]);
  const fetchedForClub = useRef<string | null>(null);

  /**
   * The current combination lives in a ref, not state, so the global key
   * listener below never re-subscribes when it changes - it just reads the
   * latest value on the next keystroke.
   */
  const shortcut = useRef(searchShortcutStore.getShortcut());

  useEffect(() => {
    const onChange = (event: Event) => {
      shortcut.current =
        (event as CustomEvent<string>).detail ??
        searchShortcutStore.getShortcut();
    };
    window.addEventListener(SEARCH_SHORTCUT_CHANGE_EVENT, onChange);
    return () =>
      window.removeEventListener(SEARCH_SHORTCUT_CHANGE_EVENT, onChange);
  }, []);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_SEARCH_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_SEARCH_EVENT, onOpen);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const isMetaK =
        (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k';

      if (isMetaK || matchesShortcut(event, shortcut.current)) {
        event.preventDefault();
        setOpen((open) => !open);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  /**
   * Places come from the same nav config the sidebar renders, filtered by the
   * same capabilities, so search never offers a member a destination the rail
   * deliberately hid. This is a rendering decision, not a security one - the
   * API refuses the request either way.
   */
  const places = useMemo<PlaceInput[]>(
    () =>
      visibleNav(capabilities).flatMap((section) =>
        section.items.map((item) => ({
          href: item.href,
          label: item.label,
          section: section.title,
          keywords: item.keywords,
        })),
      ),
    [capabilities],
  );

  // Lazily on first open, and again whenever the club changes underneath us.
  useEffect(() => {
    if (!isOpen || !clubId || fetchedForClub.current === clubId) {
      return;
    }
    fetchedForClub.current = clubId;

    let cancelled = false;
    const canSeeTreasury = capabilities.includes('expense:view');

    void (async () => {
      const [events, documents, funds, requests] = await Promise.all([
        new HttpEventRepository().list(clubId).catch(() => []),
        new HttpDocumentRepository().list(clubId).catch(() => []),
        canSeeTreasury
          ? new HttpTreasuryRepository().listFunds(clubId).catch(() => [])
          : Promise.resolve([]),
        canSeeTreasury
          ? new HttpTreasuryRepository().listRequests(clubId).catch(() => [])
          : Promise.resolve([]),
      ]);

      if (cancelled) {
        return;
      }

      setRecords([
        ...events.map((event) => ({
          kind: 'event' as const,
          id: event.id,
          label: event.title,
          sublabel: event.location ?? undefined,
          href: '/calendar',
        })),
        ...documents.map((doc) => ({
          kind: 'document' as const,
          id: doc.id,
          label: doc.title,
          href: `/documents/${doc.id}`,
        })),
        ...funds.map((fund) => ({
          kind: 'fund' as const,
          id: fund.id,
          label: fund.name,
          href: '/expenses',
        })),
        ...requests.map((request) => ({
          kind: 'request' as const,
          id: request.id,
          label: request.title,
          href: '/expenses',
        })),
      ]);
    })();

    return () => {
      cancelled = true;
      // A failed or abandoned fetch must not look like a completed one, or the
      // palette shows only places for the rest of the session.
      if (fetchedForClub.current === clubId && cancelled) {
        fetchedForClub.current = null;
      }
    };
  }, [isOpen, clubId, capabilities]);

  const toItem = useCallback(
    (result: SearchResult): SearchableItem<ItemData> => ({
      id: result.key,
      label: result.label,
      auxiliaryData: {
        group: result.group,
        sublabel: result.sublabel,
        href: result.href,
      },
    }),
    [],
  );

  const searchSource = useMemo(
    () => ({
      search: (query: string) =>
        searchSite(query, places, records).map(toItem),
      /**
       * With no query, offer the destinations rather than nothing. An empty
       * palette teaches people it needs exact words; a list of places teaches
       * them what is here.
       */
      bootstrap: () =>
        places.map((place) =>
          toItem({
            tier: 'place',
            key: placeKey(place.href),
            label: place.label,
            group: 'Go to',
            sublabel: place.section,
            href: place.href,
          }),
        ),
    }),
    [places, records, toItem],
  );

  /**
   * Every key that could ever come back, mapped to where it goes.
   *
   * Deliberately not derived from the current result list: the palette reports
   * the selected item's id, and by the time that arrives the query may have
   * changed or been cleared. Resolving against a complete map means selection
   * cannot depend on what happened to be on screen. The keys are built with
   * the same exported helpers `site-search` uses, so the two cannot drift.
   */
  const hrefByKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const place of places) {
      map.set(placeKey(place.href), place.href);
    }
    for (const record of records) {
      map.set(recordKey(record.kind, record.id), record.href);
    }
    return map;
  }, [places, records]);

  const go = useCallback(
    (value: string) => {
      const href = hrefByKey.get(value);
      setOpen(false);
      if (href) {
        router.push(href);
      }
    },
    [hrefByKey, router],
  );

  return (
    <CommandPalette
      isOpen={isOpen}
      onOpenChange={setOpen}
      label="Search COS"
      searchSource={searchSource}
      input={<AutoHighlightInput />}
      onValueChange={go}
      emptySearchText="Nothing matches that."
      renderItem={(item: SearchableItem<ItemData>) => (
        <HStack gap={3} vAlign="center" hAlign="between">
          <VStack gap={0}>
            <Text type="body">{item.label}</Text>
            {item.auxiliaryData?.sublabel ? (
              <Text type="supporting" color="secondary">
                {item.auxiliaryData.sublabel}
              </Text>
            ) : null}
          </VStack>
        </HStack>
      )}
    />
  );
}
