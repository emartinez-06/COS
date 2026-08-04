/**
 * The reduced-motion contract for the marketing site's animations.
 *
 * This is the one property of that layer that fails *silently* and cannot be
 * caught by looking at the page. Everything else about the landing page is
 * visible in a screenshot - a card at the wrong angle, a heading that did not
 * fade in - but if the reduced-motion branch of `useRevealOnScroll` ever stops
 * writing the end state, every element carrying `.reveal` stays at `opacity: 0`
 * **forever** for the people who turned that setting on. The page renders as a
 * blank ground with a nav bar, and it does so only for them.
 *
 * That is also why the assertions here are about the *end state* rather than
 * about which functions were called: the rule this codebase follows is "keep
 * the end state, drop only the sweep", and the end state is the part a visitor
 * actually depends on.
 *
 * `vitest.setup.ts` answers every media query false and says in its own comment
 * that a test needing one to match should override it locally. This does.
 */

import {useRef} from 'react';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {cleanup, render} from '@testing-library/react';

import {
  prefersReducedMotion,
  useRevealOnScroll,
  useScrollProgress,
  useSettleGroup,
  type RestState,
} from './marketing-motion';

// RTL's automatic cleanup only registers under `globals: true`, which this
// project does not enable - the same note `event-store.test.tsx` carries.
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Makes `matchMedia` answer true for the reduced-motion query only. */
function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
}

/**
 * jsdom implements no `IntersectionObserver`. The non-reduced path constructs
 * one, so without this the "motion allowed" cases throw for a reason that has
 * nothing to do with what they are testing.
 */
function stubIntersectionObserver() {
  const observe = vi.fn();
  const disconnect = vi.fn();
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe = observe;
      disconnect = disconnect;
      unobserve = vi.fn();
      takeRecords = () => [];
      root = null;
      rootMargin = '';
      thresholds = [];
    },
  );
  return {observe, disconnect};
}

function RevealProbe() {
  const ref = useRevealOnScroll<HTMLDivElement>();
  return <div ref={ref} data-testid="revealed" style={{opacity: 0}} />;
}

const REST: RestState[] = [{rotate: -7, y: 26}];

function SettleProbe() {
  const {containerRef, register} = useSettleGroup<HTMLDivElement>(REST);
  return (
    <div ref={containerRef} data-testid="container">
      <div ref={register(0)} data-testid="card" />
    </div>
  );
}

describe('prefersReducedMotion', () => {
  it('is false when the visitor has not asked for less animation', () => {
    stubReducedMotion(false);
    expect(prefersReducedMotion()).toBe(false);
  });

  it('is true when they have', () => {
    stubReducedMotion(true);
    expect(prefersReducedMotion()).toBe(true);
  });
});

describe('useRevealOnScroll under reduced motion', () => {
  it('writes the visible end state immediately, so content is never stranded invisible', () => {
    stubReducedMotion(true);
    const {getByTestId} = render(<RevealProbe />);

    const element = getByTestId('revealed');
    // The element was rendered at opacity 0, exactly as the `.reveal` class
    // does it. Reduced motion must resolve that rather than leave it.
    expect(element.style.opacity).toBe('1');
    expect(element.style.transform).toBe('none');
  });

  it('does not observe anything, because there is no reveal left to trigger', () => {
    stubReducedMotion(true);
    const {observe} = stubIntersectionObserver();
    render(<RevealProbe />);
    expect(observe).not.toHaveBeenCalled();
  });
});

describe('useRevealOnScroll with motion allowed', () => {
  it('defers to the observer instead of writing the end state up front', () => {
    stubReducedMotion(false);
    const {observe} = stubIntersectionObserver();
    const {getByTestId} = render(<RevealProbe />);

    expect(observe).toHaveBeenCalledTimes(1);
    // Still hidden: the animation is what reveals it, on intersection.
    expect(getByTestId('revealed').style.opacity).toBe('0');
  });

  it('disconnects the observer on unmount', () => {
    stubReducedMotion(false);
    const {disconnect} = stubIntersectionObserver();
    const {unmount} = render(<RevealProbe />);
    unmount();
    expect(disconnect).toHaveBeenCalled();
  });
});

/**
 * Records every progress value the hook reports, which is the only observable
 * behaviour it has - it deliberately writes no state and touches no DOM itself.
 */
function ProgressProbe({onProgress}: {onProgress: (value: number) => void}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useScrollProgress(ref, onProgress);
  return <div ref={ref} data-testid="stage" />;
}

describe('useScrollProgress under reduced motion', () => {
  it('reports the connected end state rather than the scattered start', () => {
    /**
     * This is the silent failure this whole file exists for, and the orbit has
     * the sharpest version of it yet. The hook never subscribes under reduced
     * motion, so whatever it reports once is what the section looks like
     * forever for that visitor. Reporting 0 would leave them staring at a ring
     * of unconnected tools with no connection ever drawn - the exact opposite
     * of the point the section is making, and visible to nobody testing
     * without the setting on.
     */
    stubReducedMotion(true);
    const seen: number[] = [];
    render(<ProgressProbe onProgress={(value) => seen.push(value)} />);

    expect(seen).toEqual([1]);
  });

  it('reports once and never subscribes to scrolling', () => {
    stubReducedMotion(true);
    const seen: number[] = [];
    const {unmount} = render(
      <ProgressProbe onProgress={(value) => seen.push(value)} />,
    );

    window.dispatchEvent(new Event('scroll'));
    unmount();

    expect(seen).toEqual([1]);
  });
});

describe('useSettleGroup under reduced motion', () => {
  it('leaves the cards at their natural position and applies no transform', () => {
    stubReducedMotion(true);
    const {getByTestId} = render(<SettleProbe />);

    // The scatter is drawn by CSS and cancelled by the stylesheet's own
    // reduced-motion rule. What matters here is that the hook does not install
    // a scroll-linked animation that would fight it.
    expect(getByTestId('card').style.transform).toBe('');
  });

  it('still registers its elements, so nothing depends on the animation running', () => {
    stubReducedMotion(true);
    const {getByTestId} = render(<SettleProbe />);
    expect(getByTestId('container')).toBeTruthy();
    expect(getByTestId('card')).toBeTruthy();
  });
});
