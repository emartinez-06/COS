'use client';

/**
 * The page's second movement: the tools a club already runs on, orbiting the
 * copy like a ring seen edge-on, then swinging around the back and lining up
 * into a single connected row that feeds a pipe running down the page.
 *
 * This is the product thesis rendered as motion rather than decoration. The
 * README's complaint is "ten tools, none of them connected"; a ring is a better
 * picture of that than a tidy grid ever was, because a grid is *already*
 * organised and so has nowhere to travel from. Scattered objects on unrelated
 * paths, some passing in front of the argument and some behind it, is what the
 * situation actually feels like to a new member. The row at the end is COS, and
 * the conduit leaving it is where the rest of the product will attach.
 *
 * Four things are load-bearing and easy to undo by accident:
 *
 * - **The arithmetic lives in `lib/orbit-geometry.ts`,** not here. This file
 *   only turns placements into style strings.
 * - **The engine stays behind `lib/marketing-motion.ts`.** Nothing here imports
 *   Motion; it asks for a scroll progress and gets a number. The one animation
 *   primitive used directly is `requestAnimationFrame`, which is a platform
 *   API rather than an engine choice - there is nothing to swap.
 * - **The section never pins.** It scrolls like any other block; see the note
 *   on the scroll range below, and DECISIONS.md for why that reversed.
 * - **Scroll drives the ring toward the row, never the reverse.** The resting
 *   arrangement is drawn by the server-rendered inline styles, so if JavaScript
 *   never arrives the section is a legible static ring rather than seven icons
 *   stacked on one point.
 */

import {useCallback, useEffect, useRef} from 'react';
import type {CSSProperties} from 'react';
import {VStack} from '@astryxdesign/core/Stack';
import {Heading, Text} from '@astryxdesign/core/Text';

import {
  prefersReducedMotion,
  useRevealOnScroll,
  useScrollProgress,
} from '../../lib/marketing-motion';
import {
  CENTRE_Y_RATIO,
  CONNECT_END,
  DEFAULT_STAGE,
  DEFAULT_TILE_SIZE,
  ROW_Y_RATIO,
  computeOrbitLayout,
  connectionWeight,
  lineupWeight,
  placeNode,
  type NodePlacement,
  type OrbitLayout,
} from '../../lib/orbit-geometry';
import styles from './marketing.module.css';

interface Tool {
  name: string;
  /** Initials, shown only if a tool has no logo yet. */
  mark: string;
  /** The real mark. Falls back to `mark` when absent. */
  logo?: string;
}

/**
 * The stack a real club is already running on.
 *
 * Named honestly rather than aspirationally: COS replaces none of these, which
 * is the README's own framing. A landing page implying otherwise would be
 * selling a different product than the one that exists.
 *
 * The marks are each vendor's own, used to name the product they belong to.
 * They are checked in under `public/logos/` as SVG, which is why they stay
 * sharp at every point in the orbit while a raster would soften as it scales.
 */
const TOOLS: Tool[] = [
  {name: 'Box', mark: 'Bx', logo: '/logos/box.svg'},
  {name: 'Outlook', mark: 'Ol', logo: '/logos/outlook.svg'},
  {name: 'Teams', mark: 'Tm', logo: '/logos/teams.svg'},
  {name: 'GroupMe', mark: 'GM', logo: '/logos/groupme.svg'},
  {name: 'Notion', mark: 'No', logo: '/logos/notion.svg'},
  {name: 'Excel', mark: 'Xl', logo: '/logos/excel.svg'},
  {name: 'OneDrive', mark: 'OD', logo: '/logos/onedrive.svg'},
];

/**
 * How fast the ring turns when nobody is scrolling, in radians per second.
 *
 * Roughly one revolution a minute. Slow enough that it never competes with the
 * scroll-driven sweep for attention, fast enough that the ring is visibly a
 * thing in motion rather than a diagram - which is the difference between
 * orbiting and merely being arranged in an ellipse.
 */
const DRIFT_RADIANS_PER_SECOND = 0.11;

/**
 * The wind.
 *
 * A small, continuous flutter on each icon's bank angle, at a frequency that
 * differs per icon so the ring never beats in unison. This is what stops the
 * orbit reading as a mechanism turning on rails: real things being carried
 * along are jostled. Damped to nothing by the lineup, because a row that is
 * still twitching has not settled.
 */
const FLUTTER_DEGREES = 2.2;
const FLUTTER_RADIANS_PER_SECOND = 1.7;

/**
 * The single place a placement becomes a transform, so the server render and
 * the animation frame cannot drift apart in how they express one position.
 *
 * `perspective()` has to come before the rotations it applies to, and the
 * translate has to come before that, or the icon is swung around the ring's
 * centre instead of turning on its own axis.
 */
function transformFor(place: NodePlacement, flutter = 0): string {
  return (
    `translate(calc(-50% + ${place.x.toFixed(2)}px), calc(-50% + ${place.y.toFixed(2)}px))` +
    ` perspective(620px) rotateY(${place.turn.toFixed(2)}deg)` +
    ` rotate(${(place.rotate + flutter).toFixed(2)}deg)` +
    ` scale(${place.scale.toFixed(3)})`
  );
}

export function OrbitConnect() {
  const sectionRef = useRef<HTMLElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const conduitRef = useRef<HTMLDivElement | null>(null);
  const nodesRef = useRef<(HTMLLIElement | null)[]>([]);
  const layoutRef = useRef<OrbitLayout>(
    computeOrbitLayout(DEFAULT_STAGE.width, DEFAULT_STAGE.height, TOOLS.length),
  );
  const progressRef = useRef(0);
  const driftRef = useRef(0);

  /**
   * Once the connection has been made, it stays made.
   *
   * The rest of the choreography is an ordinary reversible scrub, which is
   * right while it is still running - scrolling back up un-forms the row and
   * that reads as a physical response. But the finished state is a conclusion,
   * and a conclusion that comes apart when you scroll back to re-read the
   * headline above it is a conclusion the page keeps taking back.
   */
  const latchedRef = useRef(false);

  const headingRef = useRevealOnScroll<HTMLDivElement>();

  /**
   * Writes one frame.
   *
   * Per-node transforms have to be set per node, but everything the pipe, the
   * conduit, the ring guide, and the seven labels need is expressed as two
   * custom properties on the section - two writes instead of a dozen, and it
   * keeps the *styling* of those parts in the stylesheet where the rest of the
   * section's styling lives.
   *
   * `elapsed` is wall-clock seconds since the section started animating, zero
   * on the paths that write a single static frame - which is what makes those
   * paths produce no flutter.
   */
  const apply = useCallback(
    (rawProgress: number, drift: number, elapsed: number) => {
      const layout = layoutRef.current;

      if (latchedRef.current) rawProgress = 1;
      else if (rawProgress >= CONNECT_END) latchedRef.current = true;
      const progress = rawProgress;

      const weight = lineupWeight(progress);

      for (const [index, node] of nodesRef.current.entries()) {
        if (!node) continue;
        const place = placeNode(index, TOOLS.length, progress, layout, drift);

        const flutter =
          elapsed === 0
            ? 0
            : FLUTTER_DEGREES *
              Math.sin(elapsed * FLUTTER_RADIANS_PER_SECOND + index * 1.7) *
              (1 - weight);

        node.style.transform = transformFor(place, flutter);
        node.style.opacity = place.opacity.toFixed(3);
        node.style.setProperty('--orbit-depth', place.depth.toFixed(3));
        // The copy sits at z-index 2; this is what puts an icon in front of the
        // headline on the near half of the ring and behind it on the far half.
        node.style.zIndex = place.isNear ? '3' : '1';
      }

      const section = sectionRef.current;
      if (!section) return;
      section.style.setProperty('--orbit-lineup', weight.toFixed(3));
      section.style.setProperty(
        '--orbit-connected',
        connectionWeight(progress).toFixed(3),
      );
    },
    [],
  );

  /**
   * Measures the stage, re-lays the ring on it, and runs the conduit to the
   * bottom of the page.
   *
   * A `ResizeObserver` rather than a window resize listener because the stage's
   * width is set by the page's measure and its height by a viewport unit, so it
   * changes on things a resize event never fires for - a scrollbar appearing,
   * or a phone's browser chrome collapsing.
   */
  useEffect(() => {
    const stage = stageRef.current;
    const section = sectionRef.current;
    if (!stage || !section) return;

    const measure = () => {
      // Read rather than assumed: `--orbit-tile` shrinks under the stylesheet's
      // own narrow-screen rules, and a row laid out for the desktop tile would
      // be wider than the phone it is on.
      const declaredTile = Number.parseFloat(
        getComputedStyle(stage).getPropertyValue('--orbit-tile'),
      );
      const layout = computeOrbitLayout(
        stage.clientWidth,
        stage.clientHeight,
        TOOLS.length,
        Number.isFinite(declaredTile) && declaredTile > 0
          ? declaredTile
          : DEFAULT_TILE_SIZE,
      );
      layoutRef.current = layout;
      section.style.setProperty(
        '--orbit-row-span',
        `${(layout.rowSpacing * (TOOLS.length - 1)).toFixed(1)}px`,
      );
      section.style.setProperty(
        '--orbit-ring-w',
        `${(layout.rx * 2).toFixed(1)}px`,
      );
      section.style.setProperty(
        '--orbit-ring-h',
        `${(layout.ry * 2).toFixed(1)}px`,
      );

      /**
       * The conduit runs from the row to the end of the page's content.
       *
       * Measured rather than given a large fixed height: it has to stop
       * somewhere deliberate, and "wherever 400vh happens to land" is a
       * different place on every screen. This is the temporary end - the
       * dashboard section that will eventually receive it does not exist yet.
       */
      const conduit = conduitRef.current;
      const main = section.closest('main');
      if (conduit && main) {
        const conduitTop = conduit.getBoundingClientRect().top + window.scrollY;
        const mainBottom = main.getBoundingClientRect().bottom + window.scrollY;
        conduit.style.height = `${Math.max(mainBottom - conduitTop, 0).toFixed(0)}px`;
      }

      apply(progressRef.current, driftRef.current, 0);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    observer.observe(document.body);
    return () => observer.disconnect();
  }, [apply]);

  /**
   * Progress is measured against the section, over the span in which it is
   * actually on screen.
   *
   * The two edges are tuned rather than idiomatic, and they were arrived at by
   * measuring where the ring and the row actually sit on screen at each phase
   * rather than by picking round numbers.
   *
   * The usual `start end` opens the range the instant the section's top edge
   * appears, which spends the ring's entire resting phase on a section still
   * below the fold - the defect the settling cards were re-anchored to fix, and
   * the first thing that went wrong when this section stopped pinning. Opening
   * a quarter of the way down the viewport means the ring is genuinely on
   * screen before it starts to move, and closing at 60% means the finished row
   * lands near the middle of the screen rather than on its way out of the top.
   */
  useScrollProgress(
    sectionRef,
    (progress) => {
      progressRef.current = progress;
      // The frame loop is the writer whenever motion is allowed. Under reduced
      // motion there is no loop, and this fires exactly once, so it has to
      // write that single frame itself.
      if (prefersReducedMotion()) apply(progress, 0, 0);
    },
    ['start 26%', 'end 60%'],
  );

  /**
   * The frame loop, and the only writer while motion is allowed.
   *
   * It owns the writing rather than sharing it with the scroll callback so
   * that `elapsed`, which the flutter is built from, advances in real frame
   * steps rather than jumping with whatever scroll events happen to fire.
   *
   * Gated on intersection, so a ring three screens away is not burning a frame
   * callback for something nobody can see. Skipped outright under reduced
   * motion: a continuous, unprompted rotation is close to the definition of
   * what that setting is asking to be spared.
   */
  useEffect(() => {
    const section = sectionRef.current;
    if (!section || prefersReducedMotion()) return;

    let frame = 0;
    let running = false;
    let previous = 0;
    let origin = 0;

    const tick = (time: number) => {
      if (origin === 0) origin = time;
      const delta = previous === 0 ? 0 : (time - previous) / 1000;
      previous = time;
      driftRef.current += delta * DRIFT_RADIANS_PER_SECOND;
      apply(progressRef.current, driftRef.current, (time - origin) / 1000);
      frame = requestAnimationFrame(tick);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.some((entry) => entry.isIntersecting);
        if (visible && !running) {
          running = true;
          // Reset the clock, or the first frame back applies every second the
          // section spent off screen as one jump in the flutter's phase.
          previous = 0;
          frame = requestAnimationFrame(tick);
        } else if (!visible && running) {
          running = false;
          cancelAnimationFrame(frame);
        }
      },
      {rootMargin: '120px'},
    );

    observer.observe(section);
    return () => {
      observer.disconnect();
      if (running) cancelAnimationFrame(frame);
    };
  }, [apply]);

  const initialLayout = computeOrbitLayout(
    DEFAULT_STAGE.width,
    DEFAULT_STAGE.height,
    TOOLS.length,
  );

  return (
    <section
      className={styles.orbitSection}
      ref={sectionRef}
      style={
        {
          '--orbit-centre-y': `${CENTRE_Y_RATIO * 100}%`,
          '--orbit-row-y': `${ROW_Y_RATIO * 100}%`,
          '--orbit-row-ratio': ROW_Y_RATIO,
          '--orbit-row-span': `${initialLayout.rowSpacing * (TOOLS.length - 1)}px`,
          '--orbit-ring-w': `${initialLayout.rx * 2}px`,
          '--orbit-ring-h': `${initialLayout.ry * 2}px`,
        } as CSSProperties
      }
    >
      {/*
        A plain element rather than an Astryx stack: this is a positioning
        context for absolutely placed children, which is not a layout Astryx has
        a component for. The same escape hatch `firstScreen` already uses.
      */}
      <div className={styles.orbitStage} ref={stageRef}>
        {/*
          The ring's own path, drawn faintly so the ellipse reads as one object
          the icons are riding rather than seven independently drifting tiles.
          It fades out as they leave it - a track with nothing on it is just a
          shape on the page.
        */}
        <div className={styles.orbitRing} aria-hidden="true" />

        <div className={styles.orbitCopy}>
          <VStack
            gap={3}
            align="center"
            className={styles.reveal}
            ref={headingRef}
          >
            <Heading level={2} className={styles.sectionTitle} justify="center">
              Your club already has the tools. It has no connection between
              them.
            </Heading>
            <Text type="large" className={styles.lede} justify="center">
              COS does not replace GroupMe, Notion, Box, or Teams. It sits on
              top of them, so a new member has one place to look and officers
              stop being the search index.
            </Text>
          </VStack>
        </div>

        {/*
          A real list: seven named things, which is what a screen reader should
          be told regardless of where they happen to be orbiting. The marks are
          `aria-hidden` and the label carries the accessible name, so nothing is
          announced twice - the label is invisible for most of the scroll but
          never absent from the tree.
        */}
        <ul className={styles.orbitNodes}>
          {TOOLS.map((tool, index) => {
            const place = placeNode(index, TOOLS.length, 0, initialLayout, 0);
            return (
              <li
                key={tool.name}
                className={styles.orbitNode}
                ref={(element) => {
                  nodesRef.current[index] = element;
                }}
                style={
                  {
                    transform: transformFor(place),
                    opacity: place.opacity,
                    zIndex: place.isNear ? 3 : 1,
                    '--orbit-depth': place.depth,
                  } as CSSProperties
                }
              >
                <span className={styles.orbitTile} aria-hidden="true">
                  {tool.logo ? (
                    // Not `next/image`: these are tiny SVGs that need no
                    // resizing, and the optimiser has nothing to contribute to
                    // a vector while adding a loading state to something that
                    // must be on screen the moment the ring is.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={tool.logo} alt="" className={styles.orbitLogo} />
                  ) : (
                    tool.mark
                  )}
                </span>
                <span className={styles.orbitLabel}>{tool.name}</span>
              </li>
            );
          })}
        </ul>

        {/*
          The connection, running behind the settled row. Its lights travel
          inward from both ends toward the centre, where the conduit leaves -
          the direction is the claim, so it is not decorative that they converge
          rather than march.
        */}
        <div className={styles.orbitPipe} aria-hidden="true">
          <span className={styles.orbitPipeTrack} />
          {[0, 1].map((pulse) => (
            <span
              key={`in-${pulse}`}
              className={`${styles.orbitFlow} ${styles.orbitFlowFromLeft}`}
              style={{'--orbit-pulse-index': pulse} as CSSProperties}
            >
              <span className={styles.orbitPulse} />
            </span>
          ))}
          {[0, 1].map((pulse) => (
            <span
              key={`out-${pulse}`}
              className={`${styles.orbitFlow} ${styles.orbitFlowFromRight}`}
              style={{'--orbit-pulse-index': pulse} as CSSProperties}
            >
              <span className={styles.orbitPulse} />
            </span>
          ))}
        </div>
      </div>

      {/*
        The conduit: everything the row collects, leaving down the middle of the
        page. It is a sibling of the stage rather than a child because the stage
        clips its own overflow, and this deliberately runs past it.

        It ends at the bottom of the page's content for now, fading as it goes.
        The section that will receive it - the dashboard - does not exist yet,
        and a pipe that stops dead at a hard edge claims a destination there
        isn't one.
      */}
      <div className={styles.orbitConduit} ref={conduitRef} aria-hidden="true">
        <span className={styles.orbitConduitTrack} />
        {[0, 1, 2].map((pulse) => (
          <span
            key={pulse}
            className={styles.orbitConduitFlow}
            style={{'--orbit-pulse-index': pulse} as CSSProperties}
          >
            <span className={styles.orbitConduitPulse} />
          </span>
        ))}
      </div>
    </section>
  );
}
