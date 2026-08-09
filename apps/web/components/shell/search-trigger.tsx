'use client';

/**
 * The search box in the top bar.
 *
 * It is a button that looks like a field, not a field. Typing into a real
 * input here would mean either running search in the top bar - a result list
 * hanging off a 260px box - or moving what was typed into the palette on the
 * first keystroke, which drops characters on a fast typist. The palette owns
 * the input; this owns being findable.
 *
 * That is also why it shows the shortcut on a keycap: the fastest way in is
 * the keyboard, and a shortcut nobody is told about is a shortcut for the
 * person who wrote it.
 */

import {useEffect, useState} from 'react';
import type {CSSProperties} from 'react';
import {HStack} from '@astryxdesign/core/Stack';
import {Icon} from '@astryxdesign/core/Icon';
import {Kbd} from '@astryxdesign/core/Kbd';
import {Text} from '@astryxdesign/core/Text';
import {MagnifyingGlassIcon} from '@heroicons/react/24/outline';

import {openSearchPalette} from '../../lib/command-palette-bus';
import {
  SEARCH_SHORTCUT_CHANGE_EVENT,
  formatShortcutLabel,
  searchShortcutStore,
  toKbdKeys,
} from '../../lib/shortcut-store';

const trigger: CSSProperties = {
  appearance: 'none',
  cursor: 'pointer',
  width: '100%',
  maxWidth: 320,
  minWidth: 0,
  paddingInline: 'var(--spacing-3)',
  paddingBlock: 'var(--spacing-2)',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--color-border)',
  backgroundColor: 'var(--color-background-body)',
  textAlign: 'start',
};

export function SearchTrigger() {
  /**
   * Starts on the default on both the server pass and the first client render,
   * then syncs the stored value in an effect. Reading localStorage in a lazy
   * initialiser would make the first client render disagree with the server's
   * and trip a hydration mismatch.
   */
  const [combo, setCombo] = useState(searchShortcutStore.DEFAULT_SHORTCUT);

  useEffect(() => {
    setCombo(searchShortcutStore.getShortcut());

    const onChange = (event: Event) => {
      setCombo(
        (event as CustomEvent<string>).detail ??
          searchShortcutStore.getShortcut(),
      );
    };
    window.addEventListener(SEARCH_SHORTCUT_CHANGE_EVENT, onChange);
    return () =>
      window.removeEventListener(SEARCH_SHORTCUT_CHANGE_EVENT, onChange);
  }, []);

  return (
    <button
      type="button"
      style={trigger}
      onClick={openSearchPalette}
      // Names the action rather than describing the ornament. The keycaps
      // inside are decoration to assistive tech - the combination is in the
      // label, where it is read out as words.
      aria-label={`Search COS. Shortcut ${formatShortcutLabel(combo)}, or Command K`}>
      <HStack gap={2} vAlign="center" hAlign="between">
        <HStack gap={2} vAlign="center">
          <Icon icon={MagnifyingGlassIcon} size="sm" />
          <Text type="body" color="secondary">
            Search
          </Text>
        </HStack>
        <span aria-hidden>
          <Kbd keys={toKbdKeys(combo)} />
        </span>
      </HStack>
    </button>
  );
}
