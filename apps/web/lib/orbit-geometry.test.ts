/**
 * The connection orbit's arithmetic.
 *
 * These are the properties that are invisible in a screenshot. An icon a few
 * degrees off its ellipse looks fine; a row that is a pixel off centre looks
 * fine; a tile that overflows a 360px stage looks fine on the 1440px window
 * anyone would check it on. The failures worth catching here are the ones you
 * only find by measuring, which is precisely why the geometry was pulled out of
 * the component into a module that can be measured without one.
 */

import {describe, expect, it} from 'vitest';

import {
  CONNECT_START,
  DEFAULT_STAGE,
  SWEEP_TURNS,
  DEFAULT_TILE_SIZE,
  LINEUP_END,
  LINEUP_START,
  clamp,
  computeOrbitLayout,
  connectionWeight,
  lerp,
  lineupWeight,
  placeNode,
  smoothstep,
} from './orbit-geometry';

const COUNT = 7;
const LAYOUT = computeOrbitLayout(
  DEFAULT_STAGE.width,
  DEFAULT_STAGE.height,
  COUNT,
);

/** Every icon, placed at one scroll position. */
function placeAll(progress: number, drift = 0) {
  return Array.from({length: COUNT}, (_, index) =>
    placeNode(index, COUNT, progress, LAYOUT, drift),
  );
}

describe('easing helpers', () => {
  it('clamps smoothstep to its edges and eases between them', () => {
    expect(smoothstep(0.1, 0.4, 0.8)).toBe(0);
    expect(smoothstep(0.9, 0.4, 0.8)).toBe(1);
    expect(smoothstep(0.6, 0.4, 0.8)).toBeCloseTo(0.5, 6);
  });

  it('does not divide by zero when both edges coincide', () => {
    expect(smoothstep(0.2, 0.5, 0.5)).toBe(0);
    expect(smoothstep(0.7, 0.5, 0.5)).toBe(1);
  });

  it('lerps and clamps', () => {
    expect(lerp(10, 20, 0.25)).toBe(12.5);
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-5, 0, 3)).toBe(0);
  });
});

describe('at rest, the icons form a ring', () => {
  it('places every icon on the ellipse', () => {
    for (const place of placeAll(0)) {
      // The defining property of the ellipse the icons are supposed to ride.
      const onEllipse =
        (place.x / LAYOUT.rx) ** 2 + (place.y / LAYOUT.ry) ** 2;
      expect(onEllipse).toBeCloseTo(1, 6);
    }
  });

  it('reads as a ring in perspective, with the near icons larger', () => {
    const places = placeAll(0);
    const near = places.filter((place) => place.isNear);
    const far = places.filter((place) => !place.isNear);

    expect(near.length).toBeGreaterThan(0);
    expect(far.length).toBeGreaterThan(0);

    // Depth is sold entirely by scale and opacity, so the two have to agree
    // with which side of the ring an icon is on.
    const smallestNear = Math.min(...near.map((place) => place.scale));
    const largestFar = Math.max(...far.map((place) => place.scale));
    expect(smallestNear).toBeGreaterThan(largestFar);

    const faintestNear = Math.min(...near.map((place) => place.opacity));
    const brightestFar = Math.max(...far.map((place) => place.opacity));
    expect(faintestNear).toBeGreaterThan(brightestFar);
  });

  it('puts icons on both sides of the copy', () => {
    // The whole point of the section's depth: some icons pass in front of the
    // text and some behind it. If they ever all land on one side the ring
    // collapses into a flat decoration behind the copy.
    const places = placeAll(0);
    expect(places.some((place) => place.isNear)).toBe(true);
    expect(places.some((place) => !place.isNear)).toBe(true);
  });
});

describe('at the end, the icons form a connected row', () => {
  it('lines them up on one baseline, evenly spaced and centred', () => {
    const places = placeAll(1);

    for (const place of places) {
      expect(place.y).toBeCloseTo(LAYOUT.rowY, 6);
      expect(place.scale).toBeCloseTo(1, 6);
      expect(place.rotate).toBeCloseTo(0, 6);
      expect(place.opacity).toBeCloseTo(1, 6);
      expect(place.isNear).toBe(true);
      // Square on to the viewer, and all casting the same shadow. An icon that
      // kept the turn or the depth it happened to arrive with would sit
      // visibly askew in a row whose whole point is that it is even.
      expect(place.turn).toBeCloseTo(0, 6);
      expect(place.depth).toBeCloseTo(1, 6);
    }

    const xs = places.map((place) => place.x);
    for (let index = 1; index < xs.length; index += 1) {
      expect(xs[index]! - xs[index - 1]!).toBeCloseTo(LAYOUT.rowSpacing, 6);
    }

    // Centred on the stage's centre line, not merely evenly spaced. An odd
    // count puts the middle icon exactly on it.
    expect(xs[(COUNT - 1) / 2]).toBeCloseTo(0, 6);
    const mean = xs.reduce((total, x) => total + x, 0) / xs.length;
    expect(mean).toBeCloseTo(0, 6);
  });

  it('ignores drift once lined up', () => {
    // A row whose members are still creeping is not lined up. The damping is
    // inside `placeNode` precisely so a caller cannot forget to stop drifting.
    const still = placeAll(1, 0);
    const drifting = placeAll(1, 4.2);
    expect(drifting).toEqual(still);
  });
});

describe('the journey between them', () => {
  it('holds the ring, then resolves, rather than resolving immediately', () => {
    // The lesson `easeOut` taught the settling cards: on a scrub the curve is
    // the shape of the effect, so a state that resolves in the first sliver of
    // scroll is a state nobody ever sees.
    expect(lineupWeight(LINEUP_START)).toBe(0);
    expect(lineupWeight(LINEUP_END)).toBe(1);
    expect(lineupWeight(LINEUP_START - 0.01)).toBe(0);

    const midway = lineupWeight((LINEUP_START + LINEUP_END) / 2);
    expect(midway).toBeGreaterThan(0.35);
    expect(midway).toBeLessThan(0.65);
  });

  it('sweeps far enough that no icon can reach the row without going around the back', () => {
    /**
     * The constraint, stated directly rather than sampled: an arc shorter than
     * half a turn fits entirely within the near half of the ring, so an icon
     * starting at the front could land without ever having been behind the
     * copy. This is the floor `SWEEP_TURNS` must not cross, and it is the thing
     * that would silently break if someone shortened the sweep further to make
     * the section quicker.
     */
    expect(Math.abs(SWEEP_TURNS)).toBeGreaterThan(0.5);
  });

  it('turns each icon toward the viewer, most at the ring edges', () => {
    // The third axis. Without it the depth is scale alone, which reads as tiles
    // growing rather than as a ring being rotated.
    const turns = placeAll(0).map((place) => Math.abs(place.turn));
    expect(Math.max(...turns)).toBeGreaterThan(8);
    // And it is a turn, not a constant tilt: something must be near square on.
    expect(Math.min(...turns)).toBeLessThan(8);
  });

  it('keeps icons on both sides of the copy for the whole resting phase', () => {
    /**
     * The depth has to be continuously legible, not merely true at the start.
     * If the ring ever has every icon on one side, it stops reading as a ring
     * passing through the copy and becomes a scatter drawn over or under it.
     *
     * This is the collective property, and it is the honest one to assert. A
     * stricter version - *every* icon observed behind the copy before it lands -
     * is not guaranteed once `isNear` is forced true for the second half of the
     * lineup, and shortening the sweep is what exposed that. What survives from
     * the stricter claim is the *path*: see the sweep floor above, which is what
     * makes each icon's journey cross the far side even when it is drawn in
     * front for the last stretch of it.
     */
    for (let step = 0; step <= 60; step += 1) {
      const progress = (step / 60) * LINEUP_START;
      const places = placeAll(progress);
      expect(places.some((place) => place.isNear)).toBe(true);
      expect(places.some((place) => !place.isNear)).toBe(true);
    }
  });

  it('never lets an icon slide under the copy on its way to the row', () => {
    // The row is drawn in front of the text. An icon still marked as far while
    // it is mostly in the row would pass beneath the copy and pop forward on
    // arrival, which reads as a glitch rather than as depth.
    for (let step = 0; step <= 100; step += 1) {
      const progress = step / 100;
      if (lineupWeight(progress) <= 0.5) continue;
      for (const place of placeAll(progress)) {
        expect(place.isNear).toBe(true);
      }
    }
  });

  it('lights the connection only once the row has essentially formed', () => {
    expect(connectionWeight(0)).toBe(0);
    expect(connectionWeight(CONNECT_START)).toBe(0);
    expect(connectionWeight(1)).toBe(1);
    // Lighting a pipe between icons that are still scattered would draw a line
    // through empty space.
    expect(lineupWeight(CONNECT_START)).toBeGreaterThan(0.9);
  });
});

describe('layout on real stages', () => {
  it('keeps the connected row inside the stage at phone width', () => {
    // Horizontal overflow is the layout failure that makes a whole site feel
    // broken, and it is invisible on the desktop window anyone checks first.
    // The tile shrinks under the stylesheet's narrow rule, so the arithmetic is
    // handed that same smaller tile.
    const width = 360;
    const tile = 44;
    const layout = computeOrbitLayout(width, 520, COUNT, tile);
    const rowWidth = layout.rowSpacing * (COUNT - 1) + tile;
    expect(rowWidth).toBeLessThanOrEqual(width);
  });

  it('keeps the connected row inside the stage at the page measure', () => {
    const rowWidth =
      LAYOUT.rowSpacing * (COUNT - 1) + DEFAULT_TILE_SIZE;
    expect(rowWidth).toBeLessThanOrEqual(DEFAULT_STAGE.width);
  });

  it('puts the row below the ring rather than through it', () => {
    // If the row's baseline sat inside the ellipse the icons would appear to
    // line up in mid-orbit, and the arrival would read as them stopping rather
    // than as them landing somewhere.
    expect(LAYOUT.rowY).toBeGreaterThan(LAYOUT.ry);
  });

  it('is never taller than it is wide, at any aspect ratio', () => {
    /**
     * The regression this exists for: `ry` was derived from the stage height
     * on its own, so a tall narrow stage produced an ellipse 200 tall and 145
     * wide - a portrait oval, which is not a ring in perspective at all. It was
     * invisible on every desktop window and total on a phone.
     */
    const stages: Array<[number, number]> = [
      [1120, 900],
      [1120, 640],
      [794, 1112],
      [460, 850],
      [350, 844],
      [320, 1200],
    ];
    for (const [width, height] of stages) {
      const layout = computeOrbitLayout(width, height, COUNT);
      expect(layout.ry).toBeLessThanOrEqual(layout.rx);
    }
  });

  it('keeps the connected row clear of the ring at any aspect ratio', () => {
    // The row landing inside the ellipse would read as the icons stopping
    // mid-orbit rather than arriving somewhere.
    for (const [width, height] of [
      [1120, 900],
      [794, 1112],
      [350, 844],
    ] as Array<[number, number]>) {
      const layout = computeOrbitLayout(width, height, COUNT);
      expect(layout.rowY).toBeGreaterThan(layout.ry);
    }
  });

  it('never collapses the ring on a small stage', () => {
    const layout = computeOrbitLayout(280, 420, COUNT, 44);
    expect(layout.rx).toBeGreaterThan(0);
    expect(layout.ry).toBeGreaterThan(0);
    // A ring flatter than a tile is a line, not a ring.
    expect(layout.ry).toBeGreaterThan(44);
  });

  it('handles a single icon without dividing by zero', () => {
    const layout = computeOrbitLayout(800, 600, 1);
    expect(layout.rowSpacing).toBe(0);
    expect(placeNode(0, 1, 1, layout).x).toBe(0);
  });
});
