'use client';

/**
 * The page's signature moment: six scattered tools that settle into one row.
 *
 * This is the product thesis rendered as motion rather than decoration. The
 * README's opening complaint is "ten tools, none of them connected, and new
 * members who can't find any of them" - so the section starts with those tools
 * tilted at unrelated angles and ends with them squared up over a single line.
 * The animation *is* the sentence.
 *
 * Borrowed from getanchor.co, whose cards carry the literal class `cc-falling`
 * and rest at measured angles of -7deg, +3deg and +3deg before straightening on
 * scroll. What is borrowed is the mechanism; the meaning here is our own, since
 * their cards are their own products and ours are other people's.
 *
 * Direction matters: CSS draws the scatter and the scroll drives it to zero.
 * If JavaScript never runs the cards stay tilted and stay readable, which is
 * the right failure. Upright-by-default with JS applying the scatter would
 * flash an aligned row on every load.
 */

import type {CSSProperties} from 'react';
import {Divider} from '@astryxdesign/core/Divider';
import {Grid} from '@astryxdesign/core/Grid';
import {VStack} from '@astryxdesign/core/Stack';
import {Heading, Text} from '@astryxdesign/core/Text';

import {
  useRevealOnScroll,
  useSettleGroup,
  type RestState,
} from '../../lib/marketing-motion';
import styles from './marketing.module.css';

interface Tool {
  name: string;
  /** Initials for the stand-in mark. */
  mark: string;
  /** The mark's ground, drawn from the marketing palette. */
  tone: string;
}

/**
 * The tools a real club already runs on.
 *
 * Named honestly rather than aspirationally: COS does not replace any of
 * these, which is the README's own framing ("COS does not replace them"). A
 * landing page implying otherwise would be selling a different product than
 * the one that exists.
 */
const TOOLS: Tool[] = [
  {name: 'GroupMe', mark: 'GM', tone: 'var(--cos-mk-navy)'},
  {name: 'Notion', mark: 'No', tone: 'var(--cos-mk-ink)'},
  {name: 'Box', mark: 'Bx', tone: 'var(--cos-mk-sage)'},
  {name: 'Canva', mark: 'Cv', tone: 'var(--cos-mk-lilac)'},
  {name: 'Drive', mark: 'Dr', tone: 'var(--cos-mk-amber)'},
  {name: 'Spreadsheet', mark: 'Sh', tone: 'var(--cos-mk-clay)'},
];

/**
 * Where each card rests before it settles.
 *
 * Hand-tuned rather than random: a `Math.random()` scatter would differ
 * between the server and client render and trip a hydration mismatch, and it
 * would also mean nobody could ever tune the arrangement. The angles stay
 * small - the reference site's largest is 11 degrees - because a card tilted
 * far enough to be hard to read stops being a card and becomes a graphic.
 */
const REST_STATES: RestState[] = [
  {rotate: -9, y: 34},
  {rotate: 6, y: 54},
  {rotate: -4.5, y: 20},
  {rotate: 8, y: 46},
  {rotate: -6.5, y: 28},
  {rotate: 4.5, y: 52},
];

export function SettlingCards() {
  const {containerRef, register} = useSettleGroup<HTMLDivElement>(REST_STATES);
  const headingRef = useRevealOnScroll<HTMLDivElement>();

  return (
    // A semantic section, not a layout wrapper - it gives the page a real
    // document outline. The settle is measured against the card row itself,
    // further down, not against this element.
    <section style={{width: '100%', minWidth: 0}}>
      <VStack gap={8} align="center" width="100%">
        <VStack gap={3} align="center" className={styles.reveal} ref={headingRef}>
          <Heading level={2} className={styles.sectionTitle} justify="center">
            Your club already has the tools. It has no connection between them.
          </Heading>
          <Text type="large" className={styles.lede} justify="center">
            COS does not replace GroupMe, Notion, Box, or Canva. It sits on top
            of them, so a new member has one place to look and officers stop
            being the search index.
          </Text>
        </VStack>

        <VStack gap={5} width="100%">
          {/*
            The settle is measured against *this row*, not the surrounding
            section.

            Anchoring it to the section put the whole animation below the fold:
            the heading makes the section tall, so its centre reached the middle
            of the viewport while the cards were still off screen, and they had
            already straightened by the time anyone could see them. Measured at
            scrollY 0/300/600 the angles ran -5.7deg to 0 before the row was
            ever in view. Anchoring to the row makes the scatter resolve exactly
            as the cards cross the screen, which is the only place it means
            anything.
          */}
          {/*
            Capped at three columns so six cards form a filled 3x2 block.
            Uncapped, a 1440px window fits five and orphans the sixth on a row
            of its own - which undercuts the one thing this section is saying,
            because a row that did not come out even does not read as order.
          */}
          <Grid
            columns={{minWidth: 200, max: 3}}
            gap={4}
            width="100%"
            ref={containerRef}
          >
            {TOOLS.map((tool, index) => {
              // Falls back to a flat rest state rather than indexing blind, so
              // adding a seventh tool without a seventh angle degrades to an
              // upright card instead of crashing the page.
              const rest = REST_STATES[index] ?? {rotate: 0, y: 0};
              return (
              <VStack
                key={tool.name}
                className={styles.settleCard}
                ref={register(index)}
                style={
                  {
                    '--mk-rest-rotate': `${rest.rotate}deg`,
                    '--mk-rest-y': `${rest.y ?? 0}px`,
                  } as CSSProperties
                }
              >
                <VStack className={styles.toolCard} gap={3} justify="between">
                  <Text
                    className={styles.toolMark}
                    style={{backgroundColor: tool.tone}}
                    aria-hidden="true"
                  >
                    {tool.mark}
                  </Text>
                  <Text weight="semibold">{tool.name}</Text>
                </VStack>
              </VStack>
              );
            })}
          </Grid>

          {/* The line beneath the settled row: six things, one layer. */}
          <Divider className={styles.connector} />
        </VStack>
      </VStack>
    </section>
  );
}
