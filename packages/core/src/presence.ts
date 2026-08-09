/**
 * Whether someone is around, and whether they want to be interrupted.
 *
 * Those are two different questions and the model keeps them apart, because
 * conflating them is what makes presence indicators useless. "Active" and
 * "idle" are *observations* - the system works them out from when it last
 * heard from a browser. "Do not disturb" is a *statement*, made deliberately
 * by a person, and no amount of typing should overrule it.
 *
 * So a member's status is resolved from two inputs: a heartbeat the client
 * sends while its tab is open, and an optional choice the person made. The
 * pure resolution rule lives here rather than in the API or the UI because it
 * is the part that can be wrong, and because three copies of "how long until
 * idle" would eventually disagree about what the same row means.
 */

import {z} from 'zod';

/**
 * `offline` is deliberately not settable. It is the absence of a heartbeat,
 * not a mood - a person who wants to appear away picks `idle`, and a person
 * who wants to be left alone picks `dnd`. Letting someone claim `offline`
 * while their browser is plainly connected would make the one status that
 * currently means something factual mean nothing.
 */
export const presenceStatusSchema = z.enum([
  'active',
  'idle',
  'dnd',
  'offline',
]);

export type PresenceStatus = z.infer<typeof presenceStatusSchema>;

/** What a person may choose. `null` hands the decision back to the heartbeat. */
export const manualPresenceStatusSchema = z.enum(['active', 'idle', 'dnd']);

export type ManualPresenceStatus = z.infer<typeof manualPresenceStatusSchema>;

export const PRESENCE_STATUS_LABELS: Record<PresenceStatus, string> = {
  active: 'Active',
  idle: 'Idle',
  dnd: 'Do not disturb',
  offline: 'Offline',
};

/**
 * How long a browser may go quiet before it stops counting as active, and
 * before it stops counting as present at all.
 *
 * `ACTIVE` is deliberately several times the heartbeat interval rather than
 * equal to it. A single dropped request, a garbage-collection pause, or a
 * laptop lid closed for ten seconds should not flip someone to idle and back;
 * the indicator would flicker and people would learn to ignore it. Missing
 * three beats in a row is a real signal.
 */
export const PRESENCE_HEARTBEAT_SECONDS = 30;
export const PRESENCE_ACTIVE_SECONDS = 90;
export const PRESENCE_IDLE_SECONDS = 15 * 60;

export interface PresenceRecord {
  userId: string;
  /** What the person chose, or null to be judged by the heartbeat. */
  manualStatus: ManualPresenceStatus | null;
  /** When their browser last checked in. Null means it never has. */
  lastSeenAt: string | null;
}

/**
 * The status to show for a member.
 *
 * Order matters and each step is a decision:
 *
 * 1. **No heartbeat ever, or one older than the idle window: offline.** This
 *    outranks a manual choice on purpose. Someone who set "do not disturb" on
 *    Monday and closed their laptop is not on do-not-disturb on Friday - they
 *    are gone, and a stale badge claiming otherwise is worse than no badge.
 * 2. **A manual choice wins over the observation.** Within the window, what a
 *    person said about themselves beats what the system inferred; that is the
 *    entire reason the control exists.
 * 3. **Otherwise, derive from the heartbeat.**
 */
export function resolvePresence(
  record: PresenceRecord,
  now: Date = new Date(),
): PresenceStatus {
  if (!record.lastSeenAt) {
    return 'offline';
  }

  const secondsSince = (now.getTime() - Date.parse(record.lastSeenAt)) / 1000;

  // A clock skewed into the future would otherwise read as long-gone. Treat
  // anything ahead of us as "just now" rather than trusting the arithmetic.
  const elapsed = Math.max(secondsSince, 0);

  if (elapsed > PRESENCE_IDLE_SECONDS) {
    return 'offline';
  }

  if (record.manualStatus) {
    return record.manualStatus;
  }

  return elapsed <= PRESENCE_ACTIVE_SECONDS ? 'active' : 'idle';
}

/**
 * Whether a status should read as "reachable right now".
 *
 * Exported so that a future notification path asks this question in one place
 * instead of testing `=== 'active'` and quietly ignoring do-not-disturb.
 */
export function isInterruptible(status: PresenceStatus): boolean {
  return status === 'active';
}

export const presenceUpdateSchema = z.object({
  /**
   * Explicitly nullable rather than optional: `null` is a real instruction
   * ("go back to automatic"), and an absent field means "just a heartbeat,
   * leave my choice alone". An optional field cannot express both.
   */
  manualStatus: manualPresenceStatusSchema.nullable().optional(),
});

export type PresenceUpdate = z.infer<typeof presenceUpdateSchema>;

/** What the API returns for one member of a club. */
export const memberPresenceSchema = z.object({
  userId: z.string(),
  name: z.string(),
  image: z.string().nullable(),
  status: presenceStatusSchema,
  lastSeenAt: z.iso.datetime({offset: true}).nullable(),
});

export type MemberPresence = z.infer<typeof memberPresenceSchema>;
