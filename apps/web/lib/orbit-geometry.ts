/**
 * The connection orbit's geometry, as pure arithmetic.
 *
 * This is kept out of the component for the same reason `summarizeFund` is kept
 * out of the treasury routes: it is the part with an answer that can be *wrong*,
 * and arithmetic that has to be driven through a browser to be checked does not
 * get checked. Every function here is a pure function of an index and a scroll
 * progress, so the whole choreography is testable with no DOM at all.
 *
 * It is also deliberately free of `Math.random()`. The ring is rendered on the
 * server as well as the client, and a random scatter would differ between the
 * two passes and trip a hydration mismatch - the same rule the brick wall's
 * landing angles already follow.
 *
 * ## The model
 *
 * Icons ride an ellipse seen edge-on, the way Saturn's rings are. A point at
 * angle `t` sits at `(rx cos t, ry sin t)` with `ry` far smaller than `rx`, and
 * `sin t` doubles as the depth cue: `+1` is the near edge of the ring, passing
 * *in front of* the copy, and `-1` is the far edge, passing *behind* it. Scale
 * and opacity are interpolated from that one number, which is what makes a flat
 * ellipse read as a ring in perspective.
 *
 * Scroll then does two things at once. The whole ring keeps rotating, and each
 * icon is progressively pulled from its orbital position toward a slot in a row
 * below the copy. Because the rotation continues *during* the pull, the path
 * each icon takes is a spiral rather than a straight line - it swings around
 * the back and comes down into place, which is the effect, and it falls out of
 * the two motions overlapping rather than being choreographed key by key.
 */

const TAU = Math.PI * 2;

export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Normalises `value` to 0..1 across `[edge0, edge1]` with both ends eased.
 *
 * Used instead of a bare linear ramp because every transition here is a
 * *scrub*: the easing curve is the shape of the effect rather than its "feel",
 * which is the lesson the settling cards learned from `easeOut` (see
 * DECISIONS.md, 2026-08-03 (2)). Smoothstep leaves and arrives at rest, so an
 * icon does not visibly jerk into motion at the moment the pull begins.
 */
export function smoothstep(value: number, edge0: number, edge1: number): number {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/* ------------------------------------------------------------------ */
/* Choreography constants                                              */
/* ------------------------------------------------------------------ */

/**
 * How far the ring turns across the section's whole scroll, in revolutions.
 *
 * Cut from 1.1 to a bit over two thirds, which is one fewer trip around than
 * the first version made. The section no longer holds the page still while it
 * plays, so the same choreography has to land in less scrolling, and taking a
 * turn out is the way to do that *without* simply speeding everything up - the
 * icons still travel at a readable pace, there is just less journey.
 *
 * The floor this must not go below is **half a turn**. An arc shorter than 180
 * degrees can be positioned entirely within the near half of the ring, so an
 * icon that starts at the front would reach the row without ever having gone
 * around the back. At 0.68 every icon sweeps 245 degrees and cannot avoid it,
 * which is what makes "around the back" a property of the arrangement rather
 * than luck about where a given icon started. Pinned by a test.
 */
export const SWEEP_TURNS = 0.68;

/**
 * Scroll progress over which icons are pulled from the ring into the row.
 *
 * The section is pinned for the whole of this range, so these are fractions of
 * a fixed scroll distance rather than of the section passing by. That is what
 * buys the two things the numbers are chosen for: a stretch at the start where
 * the ring is centred, complete, and simply turning, and a stretch at the end
 * where the finished row sits still and lit. Ending the lineup at 1.0 would
 * light the connection at the exact moment the section began to leave.
 */
export const LINEUP_START = 0.3;
export const LINEUP_END = 0.74;

/**
 * Scroll progress over which the pipe lights and the labels arrive.
 *
 * Deliberately starts *before* the lineup finishes. The connection is the point
 * the section is making, and waiting for the last icon to be perfectly still
 * before acknowledging it reads as a pause where nothing happens.
 */
export const CONNECT_START = 0.7;
export const CONNECT_END = 0.86;

/** The ring's near and far edges, as scale and opacity multipliers. */
const FAR_SCALE = 0.62;
const NEAR_SCALE = 1.06;
const FAR_OPACITY = 0.55;

/**
 * How far an icon banks as it rides the ring, in degrees.
 *
 * Tied to `cos t`, so an icon is most tilted at the ring's left and right
 * extremes and level as it crosses the front and back. This is the "angled"
 * half of the brief; without it the icons read as sliding around a track rather
 * than lying on a plane that is tipped away from the viewer.
 */
const BANK_DEGREES = 15;

/**
 * How far an icon turns to face the viewer, in degrees, at the ring's extremes.
 *
 * Tied to horizontal position rather than to the angle, so an icon at the far
 * left or right turns its outer edge away as though it were mounted on the
 * surface of a cylinder, and one crossing the front or back faces square on.
 * Together with the depth scale and the shadow this is what makes the ring read
 * as a solid object being rotated rather than as flat tiles sliding around an
 * oval - a real rotation in a third axis is something no amount of scaling
 * imitates.
 */
const FACE_DEGREES = 34;

/**
 * Where the first icon sits at rest.
 *
 * Hand-picked rather than 0: at 0 an icon starts at the ring's right extreme
 * and, with an odd count, another lands square in front of the headline's first
 * line. Nudging the whole ring puts the gaps where the text is.
 */
const START_ANGLE = 0.42;

/**
 * Fraction of the stage height at which the ring's centre sits.
 *
 * Not 0.5, because the stage also has to hold the row underneath, and not the
 * 0.42 it started at either - that reserved so much room below the ring that
 * the whole group read as sitting high on the screen while the ring was the
 * only thing on it.
 */
export const CENTRE_Y_RATIO = 0.45;

/**
 * Fraction of the stage height at which the connected row forms.
 *
 * Pulled up from 0.84 after looking at the finished state: the copy ends around
 * 55% and a row at 84% left a quarter of the screen of empty ground between the
 * sentence and the thing that answers it, so they read as two unrelated halves
 * rather than as a claim and its resolution.
 */
export const ROW_Y_RATIO = 0.8;

/**
 * The stage size assumed for the server render, matching `--cos-mk-measure`
 * and the stage's own `min-height`.
 *
 * The first paint has no measured element to read, and the alternative to a
 * shared constant is markup that differs between the server and client passes.
 * The real size replaces it on mount.
 */
export const DEFAULT_STAGE = {width: 1120, height: 640};

/**
 * The tile edge assumed when nobody has measured one, matching `--orbit-tile`
 * at desktop width.
 *
 * The real value is read off that custom property and passed in, because the
 * stylesheet shrinks the tile on narrow screens and arithmetic working from a
 * stale 60px would lay out a row too wide for the stage it is sitting in. One
 * source of truth, in the stylesheet, where the responsive rule already lives.
 */
export const DEFAULT_TILE_SIZE = 60;

/* ------------------------------------------------------------------ */

/** Everything about the stage that the placement arithmetic depends on. */
export interface OrbitLayout {
  /** Ellipse half-width. */
  rx: number;
  /** Ellipse half-height. The perspective squash lives here. */
  ry: number;
  /** Centre-to-centre gap between icons once they have lined up. */
  rowSpacing: number;
  /** Vertical offset from the ring's centre down to the row. */
  rowY: number;
}

/** Where one icon is, relative to the ring's centre. Pixels and degrees. */
export interface NodePlacement {
  x: number;
  y: number;
  scale: number;
  /** Bank, in the screen plane. */
  rotate: number;
  /** Turn toward the viewer, about the vertical axis. */
  turn: number;
  opacity: number;
  /** 0 at the ring's far edge, 1 at its near edge. Drives the drop shadow. */
  depth: number;
  /** True when the icon should paint over the copy rather than behind it. */
  isNear: boolean;
}

/**
 * Derives the ring and row dimensions from the measured stage.
 *
 * Everything is clamped at both ends rather than scaled freely. The lower
 * clamps keep a 7-icon ring from collapsing into an unreadable smudge on a
 * phone; the upper ones stop it from sprawling on a large monitor, where an
 * ellipse wider than the text it surrounds stops reading as one object.
 */
export function computeOrbitLayout(
  width: number,
  height: number,
  count: number,
  tileSize: number = DEFAULT_TILE_SIZE,
): OrbitLayout {
  const rx = clamp(width * 0.415, 130, 470);

  /**
   * The vertical radius is a fraction of the horizontal one, never of the
   * stage height.
   *
   * Deriving it from the height independently is a bug that only shows up on a
   * tall narrow screen, and it is total: at 390x844 it produced `ry` of 200
   * against an `rx` of 145, so the "ring seen edge-on" was a *portrait* oval.
   * A ring taller than it is wide is not a ring in perspective at all, and the
   * depth cues hang off an ellipse that no longer reads as one.
   *
   * The squash opens up on portrait stages rather than staying fixed. At a
   * phone's aspect a strictly edge-on ring is a thin band lying across the
   * middle of the copy; letting it round out toward a circle keeps it reading
   * as something the copy sits inside. Capped below 1 so it can never invert.
   */
  const squash = clamp(0.42 * (height / Math.max(width, 1)), 0.42, 0.9);
  const ry = clamp(rx * squash, 56, height * 0.34);

  /**
   * The row spans `(count - 1) * spacing` between the outermost *centres*, plus
   * half a tile of overhang at each end, and has to fit the stage.
   *
   * The floor is a legibility limit rather than a fitting one, so below roughly
   * a 330px stage it wins and the tiles start to overlap. That is deliberate:
   * seven icons shrinking without limit stop being recognisable long before
   * they stop fitting, and the stage clips rather than scrolling sideways.
   */
  const usable = Math.max(width - 32 - tileSize, tileSize);
  const rowSpacing = count > 1 ? clamp(usable / (count - 1), 40, 132) : 0;

  return {
    rx,
    ry,
    rowSpacing,
    rowY: (ROW_Y_RATIO - CENTRE_Y_RATIO) * height,
  };
}

/** How far an icon has been pulled out of the ring and into the row, 0..1. */
export function lineupWeight(progress: number): number {
  return smoothstep(progress, LINEUP_START, LINEUP_END);
}

/** How lit the connection is, 0..1. */
export function connectionWeight(progress: number): number {
  return smoothstep(progress, CONNECT_START, CONNECT_END);
}

/**
 * Places one icon for a given scroll progress.
 *
 * `drift` is the idle rotation the ring carries when nobody is scrolling,
 * passed in raw. It is damped by the lineup here rather than at the call site,
 * so a component cannot forget to stop drifting a row that has already lined
 * up - a row whose members are still creeping is not lined up.
 */
export function placeNode(
  index: number,
  count: number,
  progress: number,
  layout: OrbitLayout,
  drift = 0,
): NodePlacement {
  const weight = lineupWeight(progress);

  const angle =
    START_ANGLE +
    (index / count) * TAU +
    progress * SWEEP_TURNS * TAU +
    drift * (1 - weight);

  // +1 at the ring's near edge, -1 at the far edge. Every depth cue below is
  // derived from this one number so they cannot disagree with each other.
  const depth = Math.sin(angle);
  const nearness = (depth + 1) / 2;

  const orbitX = layout.rx * Math.cos(angle);
  const orbitY = layout.ry * depth;

  // Centred on the row: with an odd count the middle icon sits on the centre
  // line, with an even one the gap does.
  const rowX = (index - (count - 1) / 2) * layout.rowSpacing;

  return {
    x: lerp(orbitX, rowX, weight),
    y: lerp(orbitY, layout.rowY, weight),
    scale: lerp(lerp(FAR_SCALE, NEAR_SCALE, nearness), 1, weight),
    rotate: lerp(BANK_DEGREES * Math.cos(angle), 0, weight),
    // Negative, so an icon on the right turns its right edge away from the
    // viewer - the near face of a cylinder rather than the far one.
    turn: lerp(-FACE_DEGREES * Math.cos(angle), 0, weight),
    opacity: lerp(lerp(FAR_OPACITY, 1, nearness), 1, weight),
    // Resolves to fully near as the row forms, so every landed icon casts the
    // same shadow rather than keeping whatever depth it happened to land from.
    depth: lerp(nearness, 1, weight),
    /**
     * Halfway through the pull every icon is heading for the row, which is in
     * front of the copy. Without the second clause an icon that happens to be
     * on the far side of the ring at that moment slides *under* the text on its
     * way to a row that is drawn over it, and pops forward on arrival.
     */
    isNear: depth > 0 || weight > 0.5,
  };
}
