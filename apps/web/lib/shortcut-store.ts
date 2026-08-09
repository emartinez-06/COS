/**
 * A user-rebindable keyboard shortcut: capture, match, format, persist.
 *
 * Split into its own module rather than living inside the palette because the
 * matching rule is subtle enough to be worth testing on its own, and because a
 * second rebindable shortcut is a `createShortcutStore` call rather than a
 * copied file.
 *
 * Storage is `localStorage`. This is a per-device UI preference, not club
 * data: it does not belong on the person's account, it should not sync to a
 * shared machine, and giving it an API endpoint and a migration would be
 * inventing durability nobody asked for.
 */

/** Canonical order, so one combination always produces one string. */
const MODIFIER_ORDER = ['ctrl', 'alt', 'shift', 'meta'] as const;

type Modifier = (typeof MODIFIER_ORDER)[number];

const MODIFIER_SYMBOLS: Record<Modifier, string> = {
  ctrl: '⌃',
  alt: '⌥',
  shift: '⇧',
  meta: '⌘',
};

/** `event.code` prefixes for the modifier keys themselves. */
const MODIFIER_CODE_PREFIXES = ['Alt', 'Control', 'Shift', 'Meta'];

type ModifierState = Pick<
  KeyboardEvent,
  'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'
>;

function activeModifiers(event: ModifierState): Modifier[] {
  return MODIFIER_ORDER.filter((modifier) => {
    if (modifier === 'ctrl') return event.ctrlKey;
    if (modifier === 'alt') return event.altKey;
    if (modifier === 'shift') return event.shiftKey;
    return event.metaKey;
  });
}

/**
 * Normalises `event.code` - the *physical* key - to a combo's trailing token:
 * `KeyS` becomes `s`, `Digit1` becomes `1`.
 *
 * Deliberately not `event.key`. On macOS, Option is a real dead-key modifier at
 * the OS layout level, so holding it rewrites `event.key` to a composed
 * character: Option+S arrives as `ß`, not `s`. A shortcut matched on `event.key`
 * is therefore unbindable to any Option combination on a Mac, which is most of
 * the combinations that do not already collide with the browser. `event.code`
 * is layout-independent and reports the key that was physically pressed.
 */
export function normalizeCode(code: string): string {
  if (code.startsWith('Key')) {
    return code.slice(3).toLowerCase();
  }
  if (code.startsWith('Digit')) {
    return code.slice(5);
  }
  return code.toLowerCase();
}

/**
 * Builds a combo string from a keydown, for the "record a shortcut" flow.
 *
 * Returns null while only modifiers are held, so the caller keeps listening -
 * pressing Option and then S is two events, and the first is not an answer.
 * Also returns null for a bare key with no modifier: a shortcut that fires on
 * `s` alone would trigger while someone is typing.
 */
export function captureComboFromEvent(event: KeyboardEvent): string | null {
  if (MODIFIER_CODE_PREFIXES.some((prefix) => event.code.startsWith(prefix))) {
    return null;
  }

  const modifiers = activeModifiers(event);
  if (modifiers.length === 0) {
    return null;
  }

  return [...modifiers, normalizeCode(event.code)].join('+');
}

/**
 * Whether the event is exactly this combo - every modifier it names held, and
 * no others. The "no others" half matters: without it, `alt+s` would also fire
 * on Cmd+Alt+S, stealing a combination the user may have bound elsewhere.
 */
export function matchesShortcut(event: KeyboardEvent, combo: string): boolean {
  const parts = combo.split('+');
  const key = parts[parts.length - 1];
  const required = new Set(parts.slice(0, -1));

  if (normalizeCode(event.code) !== key) {
    return false;
  }

  const held = activeModifiers(event);
  return MODIFIER_ORDER.every(
    (modifier) => held.includes(modifier) === required.has(modifier),
  );
}

/**
 * Our combo string in the vocabulary Astryx's `Kbd` expects.
 *
 * The two agree on `ctrl`, `alt` and `shift` and differ on one token: we store
 * the physical modifier as `meta`, and `Kbd` calls it `mod` - which it renders
 * as Command on a Mac and Control elsewhere. Passing `meta` straight through
 * gets it drawn as the literal text "meta".
 */
export function toKbdKeys(combo: string): string {
  return combo
    .split('+')
    .map((part) => (part === 'meta' ? 'mod' : part))
    .join('+');
}

/** `alt+s` becomes `⌥ S`, for display on a keycap. */
export function formatShortcutLabel(combo: string): string {
  const parts = combo.split('+');
  const key = parts[parts.length - 1] ?? '';
  const symbols = parts
    .slice(0, -1)
    .map((modifier) => MODIFIER_SYMBOLS[modifier as Modifier] ?? modifier);

  return [...symbols, key.toUpperCase()].join(' ');
}

export interface ShortcutStore {
  DEFAULT_SHORTCUT: string;
  CHANGE_EVENT: string;
  getShortcut(): string;
  setShortcut(combo: string): void;
  resetShortcut(): void;
}

/**
 * `changeEvent` is what lets an already-mounted listener pick up a rebinding
 * made on the settings screen without a reload. Without it the palette would
 * keep answering to the old combination until the page was refreshed, which
 * reads as the setting not having saved.
 */
export function createShortcutStore(
  storageKey: string,
  defaultCombo: string,
  changeEvent: string,
): ShortcutStore {
  return {
    DEFAULT_SHORTCUT: defaultCombo,
    CHANGE_EVENT: changeEvent,

    getShortcut(): string {
      // Server-rendered passes have no localStorage, and must agree with the
      // client's first paint or React reports a hydration mismatch.
      if (typeof window === 'undefined') {
        return defaultCombo;
      }
      return window.localStorage.getItem(storageKey) ?? defaultCombo;
    },

    setShortcut(combo: string): void {
      window.localStorage.setItem(storageKey, combo);
      window.dispatchEvent(new CustomEvent(changeEvent, {detail: combo}));
    },

    resetShortcut(): void {
      // Removed rather than written back as the default, so a later change to
      // the default reaches everyone who never chose their own.
      window.localStorage.removeItem(storageKey);
      window.dispatchEvent(
        new CustomEvent(changeEvent, {detail: defaultCombo}),
      );
    },
  };
}

/**
 * The palette's second, rebindable shortcut.
 *
 * Cmd/Ctrl+K is hardcoded in the palette and always works; this is an
 * additional combination, never a replacement. Someone who rebinds this and
 * forgets what they chose can still open search the way every other product
 * opens it.
 */
export const SEARCH_SHORTCUT_CHANGE_EVENT = 'cos:search-shortcut-changed';
export const DEFAULT_SEARCH_SHORTCUT = 'alt+s';

export const searchShortcutStore = createShortcutStore(
  'cos-search-shortcut',
  DEFAULT_SEARCH_SHORTCUT,
  SEARCH_SHORTCUT_CHANGE_EVENT,
);
