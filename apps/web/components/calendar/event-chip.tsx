'use client';

/**
 * One event as it appears inside a month-grid day cell.
 *
 * Built on Astryx `Token` rather than hand-rolled markup: a chip is a small
 * labelled datum with a category colour, which is exactly Token's job, and it
 * already handles truncation and the accessible-name wiring.
 *
 * Token's guidance cautions against using it to trigger workflows. Clicking
 * here only selects the event to inspect in the context panel - it navigates
 * attention rather than performing an action - so the caution does not apply.
 */

import {Token} from '@astryxdesign/core/Token';
import {type ClubEvent, CATEGORY_COLORS} from '@cos/core';
import {formatTime} from '../../lib/datetime';
import styles from './event-chip.module.css';

interface EventChipProps {
  event: ClubEvent;
  isSelected: boolean;
  onSelect: (event: ClubEvent) => void;
}

export function EventChip({event, isSelected, onSelect}: EventChipProps) {
  // Leading time makes a stack of chips scannable without opening any of them.
  const label = `${formatTime(event.startsAt)}  ${event.title}`;

  return (
    <Token
      size="sm"
      label={label}
      color={
        CATEGORY_COLORS[event.category] as React.ComponentProps<
          typeof Token
        >['color']
      }
      description={isSelected ? 'Currently selected' : undefined}
      className={styles.chip}
      onClick={(clickEvent) => {
        // The day cell behind the chip is itself clickable (it selects the day
        // and clears the event selection). Without this the chip's own
        // selection would be immediately undone by the bubbled cell click.
        clickEvent.stopPropagation();
        onSelect(event);
      }}
    />
  );
}
