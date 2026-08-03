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
  /** Roughly how wide, as a share of the row. Rotation makes it overlap. */
  grow: number;
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
    {label: 'Calendar', tone: 'var(--cos-mk-ink)', ink: '#fff', grow: 1.15},
    {label: 'Documents', tone: 'var(--cos-mk-sage-pale)', ink: 'var(--cos-mk-ink)', grow: 1},
  ],
  [{label: 'Treasury', tone: 'var(--cos-mk-cream-deep)', ink: 'var(--cos-mk-clay)', grow: 1.3}],
  [
    {label: 'Members', tone: 'var(--cos-mk-clay)', ink: '#fff', grow: 0.95},
    {label: 'Announcements', tone: 'var(--cos-mk-navy)', ink: '#fff', grow: 1.25},
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
  fromY: number;
  delayMs: number;
}

const DROPS: Drop[] = [
  {rotate: -3.2, fromY: 240, delayMs: 0},
  {rotate: 2.4, fromY: 280, delayMs: 120},
  {rotate: 1.8, fromY: 330, delayMs: 260},
  {rotate: -2.6, fromY: 380, delayMs: 400},
  {rotate: 1.4, fromY: 430, delayMs: 520},
];

/** Pale wall segments either side of each row's gap. */
const WALL: {left: number; right: number}[] = [
  {left: 0.55, right: 0.5},
  {left: 0.85, right: 0.7},
  {left: 0.4, right: 0.45},
];

export function BrickWall() {
  // Flat index across rows, so each brick gets its own drop state.
  let brickIndex = -1;

  return (
    <div className={styles.wall} aria-hidden="true">
      {ROWS.map((row, rowIndex) => (
        <div className={styles.wallRow} key={rowIndex}>
          <div
            className={styles.wallBrick}
            style={{flexGrow: WALL[rowIndex]?.left ?? 0.5}}
          />

          {row.map((brick) => {
            brickIndex += 1;
            const drop = DROPS[brickIndex] ?? {
              rotate: 0,
              fromY: 420,
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
                    flexGrow: brick.grow,
                    // The keyframes read these; the stylesheet owns the motion.
                    '--mk-rotate': `${drop.rotate}deg`,
                    '--mk-from-y': `${drop.fromY}px`,
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
            style={{flexGrow: WALL[rowIndex]?.right ?? 0.5}}
          />
        </div>
      ))}
    </div>
  );
}
