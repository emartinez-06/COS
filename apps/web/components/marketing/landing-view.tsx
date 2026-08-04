'use client';

/**
 * The landing page.
 *
 * Every claim here is one the product can already keep. The calendar, the
 * document hub with its revision history, and the treasury's three-number
 * balance all exist and are tested; the GroupMe bot posts but does not yet
 * read, and email delivery for invitations is not built. Nothing on this page
 * promises those, because a landing page that oversells is a support burden
 * with a marketing budget.
 *
 * Structure follows the README's own argument: the mess, the connection, what
 * officers get that the existing tools never covered, and how to start.
 */

import type {CSSProperties} from 'react';
import NextLink from 'next/link';
import {Divider} from '@astryxdesign/core/Divider';
import {Grid} from '@astryxdesign/core/Grid';
import {Link} from '@astryxdesign/core/Link';
import {HStack, VStack} from '@astryxdesign/core/Stack';
import {Heading, Text} from '@astryxdesign/core/Text';
import {
  ArrowPathIcon,
  BanknotesIcon,
  CalendarDaysIcon,
  ChatBubbleLeftRightIcon,
  DocumentTextIcon,
  LinkIcon,
} from '@heroicons/react/24/outline';

import {useRevealOnScroll, useSmoothScroll} from '../../lib/marketing-motion';
import {BrickWall} from './brick-wall';
import {MarketingFooter, MarketingNav} from './marketing-nav';
import {OrbitConnect} from './orbit-connect';
import styles from './marketing.module.css';

/**
 * The capabilities, taken from the README's own table.
 *
 * `isLive` separates what a visitor can use today from what is on the roadmap,
 * and the page says which is which rather than presenting them as one list.
 * An officer who signs up expecting alumni relations and finds a calendar has
 * been misled by the page, not by the product.
 */
interface Capability {
  title: string;
  body: string;
  icon: typeof LinkIcon;
  isLive: boolean;
}

const CAPABILITIES: Capability[] = [
  {
    title: 'Shared calendar',
    body: 'Every meeting, deadline, and event in one month view, live for the whole club the moment an officer adds it.',
    icon: CalendarDaysIcon,
    isLive: true,
  },
  {
    title: 'Document hub',
    body: 'Constitutions, waivers, and forms uploaded once. Every edit keeps its history, so you can see what changed and when.',
    icon: DocumentTextIcon,
    isLive: true,
  },
  {
    title: 'Auditable spending',
    body: 'A request pipeline that tracks what was asked for, what is still pending, and what was actually bought.',
    icon: BanknotesIcon,
    isLive: true,
  },
  {
    title: 'Integration hub',
    body: 'One club page linking Notion, Box, Canva, and anything else the club already uses. Redirects count as a win.',
    icon: LinkIcon,
    isLive: false,
  },
  {
    title: 'GroupMe bot',
    body: 'Announcements pushed into the chat the club already reads, with activity pulled back into COS.',
    icon: ChatBubbleLeftRightIcon,
    isLive: false,
  },
  {
    title: 'Officer handover',
    body: 'Institutional knowledge that stays with the club instead of graduating with the officer who held it.',
    icon: ArrowPathIcon,
    isLive: false,
  },
];

/**
 * The hero copy.
 *
 * Every line carries `.intro`, so nothing here is on screen until the wall has
 * finished building itself.
 *
 * The stagger runs **outward from the headline** rather than down the page:
 * the h1 opens at 1320ms, the eyebrow above it and the lede below it follow
 * together at 1420ms, and the buttons furthest out arrive last. Entrance order
 * and reading order are different things - the eye lands on the headline first
 * whatever the animation does, so opening on the eyebrow spends the first beat
 * on the least important line.
 *
 * Deliberately not `useRevealOnScroll`: that hook exists for things further
 * down the page that reveal when scrolled to, and this is already in view. It
 * waits on the bricks, not on the scroll position.
 */
function Hero() {
  return (
    <VStack gap={6} align="center" width="100%">
      <VStack gap={4} align="center" maxWidth={860}>
        <Text
          type="supporting"
          weight="semibold"
          justify="center"
          className={styles.intro}
          style={
            {
              '--mk-intro-delay': '1420ms',
              color: 'var(--cos-mk-clay)',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            } as CSSProperties
          }
        >
          Open source, for student clubs
        </Text>

        <Heading
          level={1}
          className={`${styles.heroTitle} ${styles.intro}`}
          justify="center"
          style={{'--mk-intro-delay': '1320ms'} as CSSProperties}
        >
          Ten tools, one club,{' '}
          <Text type="inherit" className={styles.heroTitleAccent}>
            nothing connected.
          </Text>
        </Heading>

        <Text
          type="large"
          className={`${styles.lede} ${styles.intro}`}
          justify="center"
          style={{'--mk-intro-delay': '1420ms'} as CSSProperties}
        >
          COS is the layer over the stack your club already runs on. Members get
          one place to look. Officers get the records a university department
          actually asks for.
        </Text>
      </VStack>

      <HStack
        gap={3}
        wrap="wrap"
        justify="center"
        className={styles.intro}
        style={{'--mk-intro-delay': '1520ms'} as CSSProperties}
      >
        <Link
          as={NextLink}
          href="/signup"
          className={`${styles.cta} ${styles.ctaPrimary} ${styles.ctaLarge}`}
        >
          Get started
        </Link>
        <Link
          href="https://github.com/emartinez-06/COS"
          className={`${styles.cta} ${styles.ctaSecondary} ${styles.ctaLarge}`}
          isExternalLink
        >
          Read the source
        </Link>
      </HStack>
    </VStack>
  );
}

/**
 * The treasury section.
 *
 * This is the product's sharpest differentiator and the one thing on the page
 * no spreadsheet does, so it gets its own band and a real figure rather than a
 * bullet. The three numbers shown are the model's actual shape - allocated,
 * committed, spent - and the arithmetic is the same `available = allocated -
 * committed - spent` the product enforces.
 *
 * The figures are illustrative and say so. Inventing plausible numbers on a
 * money screen without labelling them is how a demo gets mistaken for data.
 */
function TreasurySection() {
  const revealRef = useRevealOnScroll<HTMLDivElement>();

  return (
    <Grid columns={{minWidth: 340, max: 2}} gap={8} width="100%" align="center">
      <VStack gap={4} className={styles.reveal} ref={revealRef}>
        <Heading level={2} className={styles.sectionTitle}>
          A balance is three numbers, not one.
        </Heading>
        <Text type="large" className={styles.lede}>
          Every club treasurer has approved three affordable requests against a
          fund that could only cover two, and found out when the department
          declined the third the week of the event. COS tracks what is already
          promised, not just what is already gone.
        </Text>
      </VStack>

      <VStack className={styles.balanceCard} gap={4}>
        <VStack gap={1}>
          <Text weight="semibold">Dean&rsquo;s Fund 2026-27</Text>
          <Text type="supporting">Illustrative figures</Text>
        </VStack>

        <Divider />

        {/*
          Two columns, not four.

          At `minWidth: 110` the four figures shared a row and "$1,500.00" ran
          straight into "$885.50" with no gap at all - the numbers on a balance
          touching each other, which is the one place in this product where an
          ambiguous figure is worst. A 28px tabular figure needs about 145px,
          so the row gets two of them and wraps to 2x2.
        */}
        <Grid columns={{minWidth: 145, max: 2}} gap={4} width="100%">
          <VStack gap={1}>
            <Text className={styles.balanceLabel}>Allocated</Text>
            <Text className={styles.balanceFigure} hasTabularNumbers>
              $1,500.00
            </Text>
          </VStack>
          <VStack gap={1}>
            <Text className={styles.balanceLabel}>Committed</Text>
            <Text className={styles.balanceFigure} hasTabularNumbers>
              $885.50
            </Text>
          </VStack>
          <VStack gap={1}>
            <Text className={styles.balanceLabel}>Spent</Text>
            <Text className={styles.balanceFigure} hasTabularNumbers>
              $478.30
            </Text>
          </VStack>
          <VStack gap={1}>
            <Text className={styles.balanceLabel}>Available</Text>
            <Text
              className={`${styles.balanceFigure} ${styles.balanceAvailable}`}
              hasTabularNumbers
            >
              $136.20
            </Text>
          </VStack>
        </Grid>

        <Divider />

        <Text type="supporting">
          Without the committed column, this fund looks like it has $1,021.70
          left. It has $136.20.
        </Text>
      </VStack>
    </Grid>
  );
}

function CapabilitySection() {
  const revealRef = useRevealOnScroll<HTMLDivElement>();

  return (
    <VStack gap={8} width="100%">
      <VStack gap={3} className={styles.reveal} ref={revealRef} maxWidth={720}>
        <Heading level={2} className={styles.sectionTitle}>
          What a club actually needs, in one place.
        </Heading>
        <Text type="large" className={styles.lede}>
          Some of this works today. The rest is on the roadmap and labelled, so
          you can tell the difference before you sign up.
        </Text>
      </VStack>

      <Grid columns={{minWidth: 260, max: 3}} gap={6} width="100%">
        {CAPABILITIES.map((capability) => {
          const IconComponent = capability.icon;
          return (
            <VStack key={capability.title} gap={2}>
              <HStack className={styles.featureIcon} aria-hidden="true">
                <IconComponent width={20} height={20} />
              </HStack>
              <HStack gap={2} align="center" wrap="wrap">
                <Text weight="semibold">{capability.title}</Text>
                {!capability.isLive && (
                  <Text
                    type="supporting"
                    style={{
                      color: 'var(--cos-mk-clay)',
                      border: '1px solid var(--cos-mk-hairline)',
                      borderRadius: '999px',
                      padding: '1px 8px',
                      fontSize: '0.6875rem',
                    }}
                  >
                    Planned
                  </Text>
                )}
              </HStack>
              <Text type="supporting">{capability.body}</Text>
            </VStack>
          );
        })}
      </Grid>
    </VStack>
  );
}

function ClosingSection() {
  const revealRef = useRevealOnScroll<HTMLDivElement>();

  return (
    <VStack gap={5} align="center" className={styles.reveal} ref={revealRef}>
      <Heading
        level={2}
        className={styles.sectionTitle}
        justify="center"
        style={{color: 'var(--cos-mk-text-invert)'}}
      >
        Run it yourself, or let us run it.
      </Heading>
      <Text
        type="large"
        className={`${styles.lede} ${styles.ledeInvert}`}
        justify="center"
      >
        COS is AGPL-3.0, top to bottom. There is no proprietary tier holding the
        useful parts back - a club that wants to host it on its own hardware
        can, and a club that would rather not, does not have to.
      </Text>
      <HStack gap={3} wrap="wrap" justify="center">
        <Link
          as={NextLink}
          href="/signup"
          className={`${styles.cta} ${styles.ctaInvert} ${styles.ctaLarge}`}
        >
          Create an account
        </Link>
        <Link
          href="https://github.com/emartinez-06/COS"
          className={`${styles.cta} ${styles.ctaLarge}`}
          style={{
            color: 'var(--cos-mk-text-invert)',
            borderColor: 'var(--cos-mk-hairline-invert)',
          }}
          isExternalLink
        >
          Self-host it
        </Link>
      </HStack>
    </VStack>
  );
}

export function LandingView() {
  useSmoothScroll();

  return (
    <VStack className={styles.root} gap={0} width="100%">
      <VStack as="main" gap={0} width="100%">
        {/*
          Navigation, hero copy, and the wall share one viewport-height column
          so the wall is never cut by the fold. A half-visible bottom row makes
          a wall look broken rather than deliberately unfinished; the hero copy
          takes the leftover height and absorbs the difference between screens.
        */}
        <div className={styles.firstScreen}>
          <MarketingNav />

          <div className={styles.firstScreenBody}>
            <HStack
              className={`${styles.band} ${styles.bandPaper} ${styles.bandHero}`}
            >
              <HStack className={styles.measure} justify="center">
                <Hero />
              </HStack>
            </HStack>
          </div>

          {/*
            Outside the band, so it has no inline padding and the masonry runs
            off both edges. A wall that stops short of the screen edge reads as
            three floating cards with space between them, not as a wall with
            bricks missing from it - and the missing bricks are the argument.
          */}
          <BrickWall />
        </div>

        <HStack className={`${styles.band} ${styles.bandCream}`}>
          <HStack className={styles.measure}>
            <OrbitConnect />
          </HStack>
        </HStack>

        <HStack className={`${styles.band} ${styles.bandPaper}`}>
          <HStack className={styles.measure}>
            <CapabilitySection />
          </HStack>
        </HStack>

        <HStack className={`${styles.band} ${styles.bandCream}`}>
          <HStack className={styles.measure}>
            <TreasurySection />
          </HStack>
        </HStack>

        <HStack className={`${styles.band} ${styles.bandInk}`}>
          <HStack className={styles.measure} justify="center">
            <ClosingSection />
          </HStack>
        </HStack>
      </VStack>

      <MarketingFooter />
    </VStack>
  );
}
