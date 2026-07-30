/**
 * Turning upcoming events into a GroupMe announcement.
 *
 * This lives in packages/core, not in services/groupme-bot, because the officer
 * needs to preview the exact text the bot will post. One implementation, two
 * consumers - the preview cannot drift from what actually gets sent.
 *
 * The output is plain text on purpose: GroupMe renders no markup, so bold and
 * bullets would post literal asterisks into the group chat.
 */

import {
  CATEGORY_LABELS,
  type ClubEvent,
  upcomingEvents,
} from './club-event';

export interface AnnouncementOptions {
  /** Club name used in the greeting. */
  clubName: string;
  /** Cap on events included. Long messages get collapsed by GroupMe. */
  maxEvents?: number;
  /** Only include events starting within this many days. */
  withinDays?: number;
  /** Injectable clock so callers and tests can pin "now". */
  now?: Date;
}

/** An announcement the bot can post, plus the events it was built from. */
export interface AnnouncementDraft {
  text: string;
  /** Events actually referenced, in the order they appear in `text`. */
  events: ClubEvent[];
}

const DEFAULT_MAX_EVENTS = 3;
const DEFAULT_WITHIN_DAYS = 14;

/**
 * Builds the announcement text for a club's upcoming events.
 *
 * Returns an empty `events` array and a short "nothing scheduled" line when
 * there is nothing to announce, so callers can decide not to post rather than
 * having to detect emptiness by inspecting the string.
 */
export function draftAnnouncement(
  events: readonly ClubEvent[],
  options: AnnouncementOptions,
): AnnouncementDraft {
  const {
    clubName,
    maxEvents = DEFAULT_MAX_EVENTS,
    withinDays = DEFAULT_WITHIN_DAYS,
    now = new Date(),
  } = options;

  const horizon = new Date(now.getTime() + withinDays * 24 * 60 * 60 * 1000);
  const selected = upcomingEvents(events, now)
    .filter((event) => new Date(event.startsAt) <= horizon)
    .slice(0, maxEvents);

  if (selected.length === 0) {
    return {
      text: `${clubName}: nothing on the calendar for the next ${withinDays} days. Check back soon.`,
      events: [],
    };
  }

  const heading =
    selected.length === 1
      ? `${clubName} - coming up:`
      : `${clubName} - ${selected.length} events coming up:`;

  const blocks = selected.map((event) => describeEvent(event));

  return {
    text: [heading, '', ...blocks].join('\n').trimEnd(),
    events: selected,
  };
}

/** One event rendered as a plain-text block. */
function describeEvent(event: ClubEvent): string {
  const lines: string[] = [
    `${formatWhen(new Date(event.startsAt))} - ${event.title}`,
  ];

  if (event.location) {
    lines.push(`  Where: ${event.location}`);
  }

  if (event.speaker) {
    lines.push(`  Speaker: ${formatSpeaker(event.speaker)}`);
  }

  if (event.description) {
    lines.push(`  ${firstSentence(event.description)}`);
  }

  for (const link of event.links) {
    lines.push(`  ${link.label}: ${link.url}`);
  }

  lines.push(`  [${CATEGORY_LABELS[event.category]}]`, '');
  return lines.join('\n');
}

function formatSpeaker(speaker: NonNullable<ClubEvent['speaker']>): string {
  const credentials = [speaker.title, speaker.affiliation]
    .filter(Boolean)
    .join(', ');
  return credentials ? `${speaker.name} (${credentials})` : speaker.name;
}

/** e.g. `Thu Aug 14, 6:00 PM`. */
function formatWhen(date: Date): string {
  return date.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * First sentence of a description, so a long writeup does not flood the chat.
 * Falls back to a hard truncation when no sentence boundary is found.
 */
function firstSentence(text: string): string {
  const trimmed = text.trim();
  const match = /^(.*?[.!?])(\s|$)/.exec(trimmed);
  const candidate = match?.[1] ?? trimmed;
  return candidate.length > 160 ? `${candidate.slice(0, 157)}...` : candidate;
}
