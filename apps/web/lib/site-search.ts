/**
 * Ranked search across the whole signed-in product.
 *
 * Two tiers, and the order between them is fixed rather than earned:
 *
 * - **Places** - every navigable destination, taken from `nav-config` itself
 *   so the index cannot drift from the sidebar.
 * - **Records** - the club's actual events, documents, funds and requests.
 *
 * A weak Place match outranks a perfect Record match, deliberately. Someone
 * typing "cal" almost certainly wants to *go to the calendar*, not to open an
 * event whose description happens to contain those letters, and a ranker that
 * lets a long body of text out-score a destination makes navigation feel
 * unreliable. Within a tier, ordering is by match quality.
 *
 * This is a ranker, not a search engine: coarse quality buckets over labels
 * and keywords, no stemming, no BM25, no index. That is the right size for a
 * club - a few dozen events, a handful of documents - and it runs entirely in
 * memory with no round trip per keystroke.
 */

export type SearchTier = 'place' | 'record';

export type RecordKind = 'event' | 'document' | 'fund' | 'request';

export interface SearchResult {
  tier: SearchTier;
  /** Stable across renders; used as the React key and the palette's value. */
  key: string;
  label: string;
  /** The group heading, and for records the kind of thing this is. */
  group: string;
  sublabel?: string;
  href: string;
}

/** Exported for the tests; the bucket values themselves are not meaningful. */
export const NO_MATCH = null;

/**
 * The key scheme is exported because two places need it: this module, building
 * results, and the palette, resolving the id it gets back on selection to a
 * destination. Rebuilding the string by hand at the second site is how the two
 * drift and every selection silently stops navigating.
 */
export function placeKey(href: string): string {
  return `place-${href}`;
}

export function recordKey(kind: RecordKind, id: string): string {
  return `record-${kind}-${id}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Coarse quality buckets: exact beats prefix beats word-start beats substring.
 *
 * Word-start scores above a plain substring because "form" should find
 * "Spring **Form**al" ahead of "Plat**form** notes" - matching where a word
 * begins is nearly always what a person meant, and matching mid-word is
 * usually a coincidence.
 */
function scoreLabel(query: string, label: string): number | null {
  const q = query.toLowerCase().trim();
  if (!q) {
    return NO_MATCH;
  }
  const l = label.toLowerCase();
  if (l === q) {
    return 1;
  }
  if (l.startsWith(q)) {
    return 0.85;
  }
  if (new RegExp(`\\b${escapeRegExp(q)}`).test(l)) {
    return 0.7;
  }
  if (l.includes(q)) {
    return 0.55;
  }
  return NO_MATCH;
}

/**
 * The best score across the label and any keywords, with keyword hits
 * discounted - a match on a synonym is real but weaker evidence than a match
 * on the thing's actual name, so "Documents" outranks whatever merely lists
 * "documents" as a keyword.
 */
export function scoreMatch(
  query: string,
  label: string,
  keywords: readonly string[] = [],
): number | null {
  const scores: number[] = [];

  const direct = scoreLabel(query, label);
  if (direct !== NO_MATCH) {
    scores.push(direct);
  }

  for (const keyword of keywords) {
    const score = scoreLabel(query, keyword);
    if (score !== NO_MATCH) {
      scores.push(score * 0.9);
    }
  }

  return scores.length === 0 ? NO_MATCH : Math.max(...scores);
}

interface Scored extends SearchResult {
  score: number;
}

function ranked(scored: Scored[]): SearchResult[] {
  return [...scored]
    .sort((a, b) => b.score - a.score)
    .map(({score: _score, ...result}) => result);
}

export interface PlaceInput {
  href: string;
  label: string;
  /** The nav section this sits under, shown so two "Members" differ. */
  section: string;
  keywords?: readonly string[];
}

/** Tier 1 - navigable destinations. */
export function searchPlaces(
  query: string,
  places: readonly PlaceInput[],
): SearchResult[] {
  const scored: Scored[] = [];

  for (const place of places) {
    const score = scoreMatch(query, place.label, place.keywords);
    if (score === NO_MATCH) {
      continue;
    }
    scored.push({
      tier: 'place',
      key: placeKey(place.href),
      label: place.label,
      group: 'Go to',
      sublabel: place.section,
      href: place.href,
      score,
    });
  }

  return ranked(scored);
}

export interface RecordInput {
  kind: RecordKind;
  id: string;
  label: string;
  sublabel?: string;
  href: string;
  keywords?: readonly string[];
}

export const RECORD_GROUP: Record<RecordKind, string> = {
  event: 'Events',
  document: 'Documents',
  fund: 'Funds',
  request: 'Requests',
};

/** Tier 2 - the club's own content. */
export function searchRecords(
  query: string,
  records: readonly RecordInput[],
): SearchResult[] {
  const scored: Scored[] = [];

  for (const record of records) {
    const score = scoreMatch(query, record.label, record.keywords);
    if (score === NO_MATCH) {
      continue;
    }
    scored.push({
      tier: 'record',
      key: recordKey(record.kind, record.id),
      label: record.label,
      group: RECORD_GROUP[record.kind],
      sublabel: record.sublabel,
      href: record.href,
      score,
    });
  }

  return ranked(scored);
}

/**
 * Places first, always, then records. Capped, because a palette that can
 * scroll for a hundred rows is a list, and the point of ranking is that the
 * answer is near the top.
 */
export function searchSite(
  query: string,
  places: readonly PlaceInput[],
  records: readonly RecordInput[],
  limit = 12,
): SearchResult[] {
  if (!query.trim()) {
    return [];
  }
  return [
    ...searchPlaces(query, places),
    ...searchRecords(query, records),
  ].slice(0, limit);
}
