'use client';

/**
 * The marketing site's motion layer, and the only file that knows which
 * animation engine drives it.
 *
 * This is the same seam idea as `EventRepository`: the landing page asks for
 * "settle this element as the section scrolls past" and never learns whether
 * Motion, GSAP, or a future CSS scroll timeline is doing the work. Swapping
 * engines is a change to this file and nothing above it.
 *
 * **Why Motion rather than GSAP**, since the design reference (getanchor.co)
 * uses GSAP + ScrollTrigger: GSAP ships under its "standard no charge" licence,
 * which is free to use but is *not* an open-source licence. This repo is
 * AGPL-3.0 and is meant to be self-hosted, so bundling it would hand
 * downstream self-hosters redistribution terms COS cannot grant. Motion and
 * Lenis are both MIT and produce the same scroll-linked behaviour.
 *
 * **Reduced motion is handled by keeping the end state and dropping only the
 * sweep**, matching the rule the sidebar and settings-gear modules already
 * follow. A settled card is the *informative* state - it is the whole argument
 * the section makes - so it must survive when the animation does not.
 */

import {useEffect, useRef} from 'react';
import {animate, scroll} from 'motion';
import Lenis from 'lenis';

/** True when the visitor has asked the OS for less animation. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Installs Lenis smooth scrolling for as long as the component is mounted.
 *
 * This is the "weighted" scroll feel the reference site has. It is deliberately
 * scoped to the marketing layout rather than the app: inertial scrolling fights
 * a dense calendar grid, where people scroll to a specific week and expect it
 * to stop where they let go.
 *
 * Skipped entirely under reduced motion - smoothing *is* the sweep here, so
 * there is no end state to preserve, and hijacking native scroll is exactly
 * what someone with vestibular sensitivity turned the setting on to avoid.
 */
export function useSmoothScroll(): void {
  useEffect(() => {
    if (prefersReducedMotion()) return;

    const lenis = new Lenis({
      // Slightly longer than default: the settle animations are scroll-linked,
      // so a little extra glide gives them room to read as motion rather than
      // as a jump between two positions.
      duration: 1.1,
      // Touch devices already have native inertia. Doubling it feels broken.
      syncTouch: false,
    });

    let frame = 0;
    const raf = (time: number) => {
      lenis.raf(time);
      frame = requestAnimationFrame(raf);
    };
    frame = requestAnimationFrame(raf);

    return () => {
      cancelAnimationFrame(frame);
      lenis.destroy();
    };
  }, []);
}

/** Where an element sits before it settles. Degrees and pixels. */
export interface RestState {
  rotate: number;
  y?: number;
  x?: number;
  scale?: number;
}

/**
 * Ties an element's settle to the scroll position of a container.
 *
 * The element travels from `rest` to its natural position (no rotation, no
 * offset) as `container` moves through the viewport, and it is *scrubbed*
 * rather than triggered: scrolling back up un-settles it. That reversibility
 * is what makes the effect read as a physical response to scrolling instead of
 * a one-shot animation that fires and is over.
 *
 * Returns a cleanup function.
 */
export function settleOnScroll(
  element: HTMLElement,
  container: HTMLElement,
  rest: RestState,
): () => void {
  return scroll(
    animate(
      element,
      {
        rotate: [rest.rotate, 0],
        y: [rest.y ?? 0, 0],
        x: [rest.x ?? 0, 0],
        scale: [rest.scale ?? 1, 1],
      },
      {
        /**
         * Holds the tilt, then straightens.
         *
         * This was `easeOut`, which is the wrong curve for a scrub and the
         * reason the angle was almost invisible: easeOut spends most of its
         * output range in the first sliver of input, so the cards were
         * essentially straight before they had travelled any distance, then
         * crept the last fraction of a degree for the rest of the scroll.
         *
         * An ease-in-out holds near the resting angle through the first half
         * of the range and resolves in the second, so the crooked state is
         * something you actually see rather than something the code merely
         * passes through.
         */
        ease: [0.65, 0, 0.35, 1],
      },
    ),
    {
      target: container,
      /**
       * Begins as the row's top reaches the bottom of the viewport and ends as
       * its bottom reaches the middle. Deliberately longer than
       * `center center`: the crooked phase needs scroll distance to be read,
       * and the shorter range resolved it while the row was still entering.
       */
      offset: ['start end', 'end center'],
    },
  );
}

/**
 * The hero's brick drop is deliberately **not** here.
 *
 * It is a one-shot entrance with no scroll linkage, so it lives in
 * `marketing.module.css` as keyframes instead. Two reasons, both found by
 * building it the other way first:
 *
 * - Animating `opacity` from JavaScript while the stylesheet leaves the element
 *   at 1 paints the finished wall, snaps it invisible when the animation takes
 *   over, and drops it in again. Keyframes have no such gap.
 * - Keyframes keep JavaScript off the hero's critical path, so the wall still
 *   builds itself if the bundle never arrives.
 *
 * The rule this suggests generally: scroll-linked motion needs this module,
 * entrance motion does not.
 */

/**
 * React binding for {@link settleOnScroll}.
 *
 * Give the returned `containerRef` to the section and register each animated
 * child through `register`. Children are keyed by index so the hook can hand
 * each one its own rest state.
 */
export function useSettleGroup<T extends HTMLElement = HTMLElement>(
  restStates: RestState[],
) {
  const containerRef = useRef<T | null>(null);
  const itemsRef = useRef<(HTMLElement | null)[]>([]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Under reduced motion every element stays at its natural position, which
    // is where the CSS already draws it. Nothing to do, and nothing to undo.
    if (prefersReducedMotion()) return;

    const cleanups = itemsRef.current.map((element, index) => {
      const rest = restStates[index];
      if (!element || !rest) return () => {};
      return settleOnScroll(element, container, rest);
    });

    return () => {
      for (const cleanup of cleanups) cleanup();
    };
    // `restStates` is a module-level constant at every call site; spreading it
    // into the dep array would rebuild every subscription on each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const register = (index: number) => (element: HTMLElement | null) => {
    itemsRef.current[index] = element;
  };

  return {containerRef, register};
}

/**
 * Reveals an element once, when it first scrolls into view.
 *
 * Used for section headings and copy, where the reference site uses a
 * per-character SplitText reveal. This does it per *element* instead, on
 * purpose: SplitText wraps every letter in its own node, which is what makes
 * getanchor.co's accessibility tree read out "d", "u", "c", "t", "s" as five
 * separate text nodes. A heading that a screen reader spells out one letter at
 * a time is a real regression, and no visual flourish is worth it.
 *
 * Not scrubbed, unlike the cards: text that fades back out when you scroll up
 * is text you cannot re-read.
 */
export function useRevealOnScroll<T extends HTMLElement>(delay = 0) {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    if (prefersReducedMotion()) {
      element.style.opacity = '1';
      element.style.transform = 'none';
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          animate(
            entry.target,
            {opacity: [0, 1], y: [16, 0]},
            {duration: 0.55, delay, ease: [0.22, 1, 0.36, 1]},
          );
          observer.unobserve(entry.target);
        }
      },
      {threshold: 0.15},
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [delay]);

  return ref;
}
