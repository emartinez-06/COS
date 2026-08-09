'use client';

/**
 * The frame every dashboard card shares: a heading that is itself the way in,
 * a count beside it, the card's own content, and one explicit link out.
 *
 * The whole card is deliberately *not* one big click target. These cards carry
 * their own links and text worth selecting, and a card-sized anchor swallows
 * both - `ClickableCard` is the right component for a tile whose entire job is
 * to be a destination, and the wrong one for a summary someone reads.
 *
 * So there are two ways through and both are real anchors: the heading, for
 * anyone who has already decided, and a named link at the foot, which is what
 * makes the destination discoverable rather than something you find by
 * hovering. The footer link says where it goes - "Open the calendar", never
 * "View all" - because a link's text is its accessible name and a screen
 * reader listing four "View all"s has told the reader nothing.
 */

import type {CSSProperties, ReactNode} from 'react';
import NextLink from 'next/link';
import {Card} from '@astryxdesign/core/Card';
import {Link} from '@astryxdesign/core/Link';
import {HStack, VStack} from '@astryxdesign/core/Stack';
import {Heading, Text} from '@astryxdesign/core/Text';
import {Icon} from '@astryxdesign/core/Icon';
import {ArrowRightIcon} from '@heroicons/react/24/outline';

/** Lets the body take the slack so a row of cards ends on one line. */
const fill: CSSProperties = {height: '100%', minWidth: 0};
const body: CSSProperties = {flex: 1, minWidth: 0};

export function CardShell({
  title,
  href,
  actionLabel,
  meta,
  children,
}: {
  title: string;
  href: string;
  /** Names the destination. Never "View all" - see the note above. */
  actionLabel: string;
  meta?: string;
  children: ReactNode;
}) {
  return (
    <Card padding={5} style={fill}>
      <VStack gap={4} hAlign="stretch" style={fill}>
        <HStack gap={3} vAlign="center" hAlign="between">
          <Heading level={3}>
            <Link as={NextLink} href={href}>
              {title}
            </Link>
          </Heading>
          {meta ? (
            <Text type="supporting" color="secondary">
              {meta}
            </Text>
          ) : null}
        </HStack>

        <VStack gap={0} hAlign="stretch" style={body}>
          {children}
        </VStack>

        <HStack gap={2} vAlign="center">
          <Link as={NextLink} href={href} isStandalone>
            {actionLabel}
          </Link>
          <Icon icon={ArrowRightIcon} size="sm" />
        </HStack>
      </VStack>
    </Card>
  );
}
