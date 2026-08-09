/**
 * What jsdom is missing before an Astryx component will render.
 *
 * jsdom implements no `window.matchMedia` at all - not a stub, not a throwing
 * stub, nothing. Astryx's `useTheme` calls it through `useMediaQuery` on every
 * component that resolves a theme token at runtime, which includes `Spinner`,
 * which is what a `Button` renders while it is loading. The result is that a
 * component test only fails once the code under test does something
 * asynchronous, which makes it look like the async behaviour is broken rather
 * than the environment.
 *
 * It lives in a setup file rather than in a test because it is a fact about the
 * environment, not about any one component, and the second `components/` test
 * would otherwise rediscover it.
 *
 * Every query answers false: the tests run at a fixed desktop-ish viewport and
 * nothing here is checking responsive behaviour. A test that ever needs a query
 * to match should override this for itself rather than change the default,
 * which would silently move every other test to a different viewport.
 */

/**
 * jsdom has no canvas implementation, and Astryx's `Spinner` draws its ring on
 * one. It already handles the absence - it reads `getContext('2d')` and returns
 * early when the answer is null - but jsdom's own stub logs "Not implemented"
 * through the virtual console before returning undefined, once per render.
 *
 * Answering null is what the component is written for and what a real browser
 * without canvas would say. Installing the `canvas` package to draw a spinner
 * nobody looks at would be the alternative.
 */
if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = () => null;
}

/**
 * jsdom does no layout, so it implements no `scrollIntoView` at all. Calling it
 * is a TypeError rather than a no-op, which would turn "the editor scrolls its
 * conflict message into view" into a crash in every test that produces one.
 *
 * A no-op is the honest stub: there is nothing to scroll and nothing here
 * asserts on scrolling. A test that ever needs to check it should spy on this.
 */
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

/**
 * jsdom declares `window.localStorage` but it evaluates to `undefined` here.
 * The property descriptor exists, so the usual `!window.localStorage` guard
 * reads as "present" while any use of it throws - which is why this checks the
 * *value* rather than the key.
 *
 * The cause is the environment, not our code: Node 22 ships its own
 * experimental `localStorage` that is inert unless started with
 * `--localstorage-file`, and it shadows jsdom's implementation. The visible
 * symptom is a `ExperimentalWarning: localStorage is not available` line and a
 * TypeError on first use.
 *
 * An in-memory Storage is the right stub. It is what the browser gives us in
 * production, the shortcut store's whole contract is "write it, read it back",
 * and a stub that only pretended to persist would let a broken round trip
 * pass. Backed by a Map so each run starts empty and `clear()` is real.
 */
if (typeof window !== 'undefined' && !window.localStorage) {
  const memoryStorage = (): Storage => {
    const entries = new Map<string, string>();
    return {
      get length() {
        return entries.size;
      },
      key: (index: number) => [...entries.keys()][index] ?? null,
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => {
        entries.set(key, String(value));
      },
      removeItem: (key: string) => {
        entries.delete(key);
      },
      clear: () => {
        entries.clear();
      },
    } as Storage;
  };

  Object.defineProperty(window, 'localStorage', {
    value: memoryStorage(),
    configurable: true,
  });
  Object.defineProperty(window, 'sessionStorage', {
    value: memoryStorage(),
    configurable: true,
  });
}

if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}
