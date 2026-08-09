import {beforeEach, describe, expect, it, vi} from 'vitest';

import {
  captureComboFromEvent,
  createShortcutStore,
  formatShortcutLabel,
  matchesShortcut,
  normalizeCode,
} from './shortcut-store';

/**
 * A keydown as the matcher sees it. `code` is the physical key and `key` is
 * what the OS layout produced - the two differ under Option on macOS, which is
 * the whole reason this module reads `code`.
 */
function keydown(
  code: string,
  modifiers: Partial<
    Pick<KeyboardEvent, 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>
  > = {},
  key = 'x',
): KeyboardEvent {
  return {
    code,
    key,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...modifiers,
  } as KeyboardEvent;
}

describe('normalizeCode', () => {
  it('strips the Key and Digit prefixes', () => {
    expect(normalizeCode('KeyS')).toBe('s');
    expect(normalizeCode('Digit1')).toBe('1');
  });

  it('passes other codes through lowercased', () => {
    expect(normalizeCode('Slash')).toBe('slash');
  });
});

describe('captureComboFromEvent', () => {
  it('builds a combo from modifiers and the physical key', () => {
    expect(captureComboFromEvent(keydown('KeyS', {altKey: true}))).toBe(
      'alt+s',
    );
  });

  /**
   * The macOS case this module exists for. Holding Option rewrites `event.key`
   * to a composed character, so a matcher reading `key` would store `alt+ß`
   * and then never fire again.
   */
  it('ignores the composed character Option produces on macOS', () => {
    const combo = captureComboFromEvent(
      keydown('KeyS', {altKey: true}, 'ß'),
    );

    expect(combo).toBe('alt+s');
  });

  it('orders modifiers canonically regardless of which were pressed', () => {
    const combo = captureComboFromEvent(
      keydown('KeyK', {metaKey: true, shiftKey: true, ctrlKey: true}),
    );

    expect(combo).toBe('ctrl+shift+meta+k');
  });

  it('keeps listening while only modifiers are held', () => {
    expect(captureComboFromEvent(keydown('AltLeft', {altKey: true}))).toBeNull();
    expect(
      captureComboFromEvent(keydown('ShiftLeft', {shiftKey: true})),
    ).toBeNull();
  });

  /** A modifier-less shortcut would fire while someone is typing. */
  it('refuses a bare key with no modifier', () => {
    expect(captureComboFromEvent(keydown('KeyS'))).toBeNull();
  });
});

describe('matchesShortcut', () => {
  it('matches the exact combination', () => {
    expect(matchesShortcut(keydown('KeyS', {altKey: true}), 'alt+s')).toBe(
      true,
    );
  });

  it('does not match a different key', () => {
    expect(matchesShortcut(keydown('KeyD', {altKey: true}), 'alt+s')).toBe(
      false,
    );
  });

  it('does not match when a required modifier is missing', () => {
    expect(matchesShortcut(keydown('KeyS'), 'alt+s')).toBe(false);
  });

  /**
   * Without this, `alt+s` would also fire on Cmd+Alt+S and quietly steal a
   * combination bound to something else.
   */
  it('does not match when an extra modifier is held', () => {
    expect(
      matchesShortcut(keydown('KeyS', {altKey: true, metaKey: true}), 'alt+s'),
    ).toBe(false);
  });

  it('matches a multi-modifier combo', () => {
    expect(
      matchesShortcut(
        keydown('KeyK', {ctrlKey: true, shiftKey: true}),
        'ctrl+shift+k',
      ),
    ).toBe(true);
  });
});

describe('formatShortcutLabel', () => {
  it('renders modifier symbols and an uppercase key', () => {
    expect(formatShortcutLabel('alt+s')).toBe('⌥ S');
    expect(formatShortcutLabel('ctrl+shift+meta+k')).toBe('⌃ ⇧ ⌘ K');
  });
});

describe('createShortcutStore', () => {
  const KEY = 'cos-test-shortcut';
  const CHANGE = 'cos:test-shortcut-changed';

  beforeEach(() => {
    window.localStorage.clear();
  });

  it('falls back to the default when nothing is stored', () => {
    const store = createShortcutStore(KEY, 'alt+s', CHANGE);

    expect(store.getShortcut()).toBe('alt+s');
  });

  it('persists and reads back a chosen combo', () => {
    const store = createShortcutStore(KEY, 'alt+s', CHANGE);
    store.setShortcut('ctrl+j');

    expect(store.getShortcut()).toBe('ctrl+j');
  });

  it('announces a change so mounted listeners can follow it', () => {
    const store = createShortcutStore(KEY, 'alt+s', CHANGE);
    const heard = vi.fn();
    window.addEventListener(CHANGE, heard);

    store.setShortcut('ctrl+j');

    expect(heard).toHaveBeenCalledOnce();
    expect((heard.mock.calls[0]![0] as CustomEvent<string>).detail).toBe(
      'ctrl+j',
    );
    window.removeEventListener(CHANGE, heard);
  });

  /**
   * Removed rather than overwritten with the default, so someone who never
   * chose a combination follows a later change to the default.
   */
  it('clears storage on reset rather than writing the default into it', () => {
    const store = createShortcutStore(KEY, 'alt+s', CHANGE);
    store.setShortcut('ctrl+j');
    store.resetShortcut();

    expect(window.localStorage.getItem(KEY)).toBeNull();
    expect(store.getShortcut()).toBe('alt+s');
  });

  it('announces the default on reset', () => {
    const store = createShortcutStore(KEY, 'alt+s', CHANGE);
    const heard = vi.fn();
    window.addEventListener(CHANGE, heard);

    store.resetShortcut();

    expect((heard.mock.calls[0]![0] as CustomEvent<string>).detail).toBe(
      'alt+s',
    );
    window.removeEventListener(CHANGE, heard);
  });

  it('keeps two stores independent', () => {
    const search = createShortcutStore(KEY, 'alt+s', CHANGE);
    const other = createShortcutStore('cos-other', 'alt+j', 'cos:other');

    search.setShortcut('ctrl+1');

    expect(other.getShortcut()).toBe('alt+j');
  });
});
