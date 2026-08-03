'use client';

/**
 * The hero's brick wall: bricks drop from above and land crooked in the gaps.
 *
 * Taken from getanchor.co's hero, which is built from `hero-empty_block`
 * elements forming pale masonry rows that run off both edges of the screen with
 * a hole in the middle of each, and `product-tool cc-falling` bricks - coloured,
 * labelled, and tilted - sitting in those holes.
 *
 * **The bricks land crooked and stay crooked**, which is the entire point and
 * the thing that separates this from the settle further down the page. A wall
 * whose pieces all squared up on landing would read as a rendered diagram; one
 * where they do not reads as something that was *built*, by people, out of
 * parts that did not quite match. For a product about clubs assembling their
 * own stack out of whatever they already had, that is the right feeling.
 *
 * The wall is also the argument: it has holes in it, and the labelled pieces
 * are what fills them.
 */

import type {CSSProperties} from 'react';
import {Text} from '@astryxdesign/core/Text';

import styles from './marketing.module.css';

interface Brick {
  label: string;
  /** Brick ground. */
  tone: string;
  /** Label colour that clears its ground. */
  ink: string;
  /**
   * Width as a share of the row.
   *
   * Every item in a row is a fixed share and the shares deliberately do not
   * add up to 100, so the remainder shows as bare ground between them. That
   * leftover *is* the hole the brick sits in - when the children grew to fill
   * the row instead, brick met wall edge to edge and there was no hole left to
   * see.
   */
  width: number;
}

/**
 * COS's own surfaces, not the tools it connects.
 *
 * This mirrors the reference exactly: Anchor's bricks are *their* product
 * areas (Accounts, Payments, Cards, Credit, Savings), not their integrations.
 * The tools a club already owns get the section further down the page, which
 * keeps the two ideas from blurring - this is what COS is, that is what it
 * sits on top of.
 */
const ROWS: Brick[][] = [
  [
    {label: 'Calendar', tone: 'var(--cos-mk-ink)', ink: '#fff', width: 22},
    {
      label: 'Documents',
      tone: 'var(--cos-mk-sage-pale)',
      ink: 'var(--cos-mk-ink)',
      width: 20,
    },
  ],
  [
    {
      label: 'Treasury',
      tone: 'var(--cos-mk-cream-deep)',
      ink: 'var(--cos-mk-clay)',
      width: 23,
    },
  ],
  [
    {label: 'Members', tone: 'var(--cos-mk-clay)', ink: '#fff', width: 18},
    {label: 'Announcements', tone: 'var(--cos-mk-navy)', ink: '#fff', width: 25},
  ],
];

/**
 * Landing angles, fall heights, and drop order.
 *
 * Constants, never random - a random tilt differs between the server and client
 * render and trips a hydration mismatch, and it also means the arrangement can
 * never be tuned.
 *
 * The angles are *smaller* than the settling cards further down (about 3
 * degrees against 9). These keep their tilt permanently, and a permanent tilt
 * has to sit in a narrow band: too little reads as a rendering bug, too much
 * reads as a broken layout. A tilt that resolves can afford to be dramatic
 * because it is on its way somewhere.
 */
interface Drop {
  rotate: number;
  /** Any CSS length. Viewport units so the fall starts off-page at any size. */
  fromY: string;
  delayMs: number;
}

/**
 * Fall distances are viewport-relative so every brick genuinely starts above
 * the top of the page rather than a fixed number of pixels above its own slot.
 * The wall sits at the bottom of the first screen, so `100dvh` clears it on any
 * window.
 *
 * The whole sequence finishes inside a second. It was 1.24s, and the hero copy
 * now waits for it - so every millisecond here is a millisecond the headline is
 * not on screen, which is a cost worth keeping small.
 */
const DROPS: Drop[] = [
  {rotate: -3.2, fromY: '104dvh', delayMs: 0},
  {rotate: 2.4, fromY: '110dvh', delayMs: 105},
  {rotate: 1.8, fromY: '116dvh', delayMs: 215},
  {rotate: -2.6, fromY: '122dvh', delayMs: 320},
  {rotate: 1.4, fromY: '128dvh', delayMs: 425},
];

export function BrickWall() {
  // Flat index across rows, so each brick gets its own drop state.
  let brickIndex = -1;

  return (
    <div className={styles.wall} aria-hidden="true">
      {ROWS.map((row, rowIndex) => (
        <div className={styles.wallRow} key={rowIndex}>
          <div className={styles.wallBrick} />

          {row.map((brick) => {
            brickIndex += 1;
            const drop = DROPS[brickIndex] ?? {
              rotate: 0,
              fromY: '110dvh',
              delayMs: 0,
            };
            return (
              <div
                key={brick.label}
                className={styles.brick}
                style={
                  {
                    backgroundColor: brick.tone,
                    color: brick.ink,
                    flexBasis: `${brick.width}%`,
                    // The keyframes read these; the stylesheet owns the motion.
                    '--mk-rotate': `${drop.rotate}deg`,
                    '--mk-from-y': drop.fromY,
                    '--mk-delay': `${drop.delayMs}ms`,
                  } as CSSProperties
                }
              >
                <Text className={styles.brickLabel}>{brick.label}</Text>
              </div>
            );
          })}

          <div
            className={styles.wallBrick}
          />
        </div>
      ))}
    </div>
  );
}
