'use client';

/**
 * A person, with their status on them.
 *
 * Astryx gives three status variants and this product has four statuses, so
 * the mapping needs a decision rather than a lookup table that quietly
 * collides. **Offline gets no dot at all.**
 *
 * That is the right one to drop for two reasons. It is the only status that is
 * not a claim about a person - it is the absence of information, and absence
 * of a badge is the honest way to draw absence of information. And it is by
 * far the most common state in a club of thirty people, so drawing it would
 * put a grey ring on almost every avatar and leave the two dots that mean
 * something competing with thirty that do not.
 *
 * The remaining three map onto variants whose shapes differ as well as their
 * colours - a filled dot, a ring, a bar - so the status survives colour
 * blindness and a greyscale print, which is the WCAG 1.4.1 point of Astryx
 * shipping shapes rather than three coloured circles.
 *
 * The status is always in the accessible label as words, whether or not a dot
 * is drawn.
 */

import {Avatar, AvatarStatusDot} from '@astryxdesign/core/Avatar';
import {PRESENCE_STATUS_LABELS, type PresenceStatus} from '@cos/core';

type DotVariant = 'success' | 'neutral' | 'error';

/** Null means "draw no dot" - see the note above about offline. */
const STATUS_VARIANT: Record<PresenceStatus, DotVariant | null> = {
  active: 'success',
  idle: 'neutral',
  dnd: 'error',
  offline: null,
};

export function MemberAvatar({
  name,
  image,
  status,
  size = 'md',
  /**
   * Suppresses the built-in name tooltip, for callers who put the name beside
   * the avatar anyway - a tooltip repeating text that is already on screen is
   * noise, and Astryx's own guidance is to disable it when you supply your own
   * overlay.
   */
  hasTooltip = true,
}: {
  name: string;
  image?: string | null;
  status: PresenceStatus;
  size?: 'xsm' | 'sm' | 'md' | 'lg' | 'xl';
  hasTooltip?: boolean;
}) {
  const variant = STATUS_VARIANT[status];
  const statusLabel = PRESENCE_STATUS_LABELS[status];

  return (
    <Avatar
      name={name}
      src={image ?? undefined}
      size={size}
      /*
       * The status must be announced exactly once.
       *
       * Astryx composes a status dot's own `label` into the avatar's
       * accessible name (0.2.0, WCAG 4.1.2), so putting the status in `alt`
       * as well produced "Avery Officer - Do not disturb, Do not disturb".
       * Found by reading the rendered aria-label rather than by looking at
       * the screen, where it is invisible.
       *
       * So `alt` carries the status only in the case where there is no dot to
       * carry it - offline. Otherwise "offline" would be information a
       * sighted reader infers from a missing badge and a screen-reader user
       * never receives at all.
       */
      alt={variant ? name : `${name} - ${statusLabel}`}
      tooltip={hasTooltip ? `${name} - ${statusLabel}` : false}
      status={
        variant ? (
          <AvatarStatusDot variant={variant} label={statusLabel} />
        ) : undefined
      }
    />
  );
}
