'use client';

/**
 * The treasury: what the club was given, what it has asked for, and what is
 * left to ask for.
 *
 * The page leads with the three numbers because that is what someone opened it
 * to find out. Everything below is the evidence for them.
 *
 * **No figure on this page is fetched.** Every one is folded from the club's
 * own rows by `summarizeFund` in @cos/core, the same function the API tests use
 * and the same one a future export will use. There is one implementation of the
 * arithmetic in the product, which is why the number here cannot drift from the
 * number anywhere else.
 *
 * Officers only, including read - the route's `CapabilityGuard` handles that,
 * and the API enforces it independently.
 */

import {useState, type CSSProperties} from 'react';
import {Badge} from '@astryxdesign/core/Badge';
import {Banner} from '@astryxdesign/core/Banner';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {EmptyState} from '@astryxdesign/core/EmptyState';
import {Icon} from '@astryxdesign/core/Icon';
import {Skeleton} from '@astryxdesign/core/Skeleton';
import {HStack, VStack} from '@astryxdesign/core/Stack';
import {Heading, Text} from '@astryxdesign/core/Text';
import {BanknotesIcon} from '@heroicons/react/24/outline';
import type {Fund} from '@cos/core';
import {FUND_SOURCE_LABELS, formatMoney} from '@cos/core';

import {useCan, useSession} from '../../lib/session';
import {useTreasury} from '../../lib/treasury-store';
import {FundBalance} from './fund-balance';
import {FundComposerDialog} from './fund-composer-dialog';
import {RequestComposerDialog} from './request-composer-dialog';
import {RequestList} from './request-list';

const page: CSSProperties = {
  padding: 'var(--spacing-5)',
  minWidth: 0,
  maxWidth: 1000,
};

const cardBody: CSSProperties = {minWidth: 0};

/** Whole days from today until a date, negative once it has passed. */
function daysUntil(isoDate: string): number {
  const end = new Date(`${isoDate}T23:59:59`).getTime();
  return Math.ceil((end - Date.now()) / (1000 * 60 * 60 * 24));
}

function FundCard({fund}: {fund: Fund}) {
  const {summaryFor} = useTreasury();
  const summary = summaryFor(fund.id);
  const remainingDays = daysUntil(fund.endsOn);

  /**
   * The use-it-or-lose-it warning.
   *
   * Not decoration: dean's offices cut next year's allocation for clubs that
   * underspend this year's, so money left on the table has a cost beyond
   * itself. Only shown when it is actionable - unspent money, a real deadline,
   * and a fund that actually expires.
   */
  const isExpiring =
    fund.expiresUnspent &&
    fund.closedAt === null &&
    remainingDays > 0 &&
    remainingDays <= 45 &&
    summary.availableCents > 0;

  return (
    <Card padding={5}>
      <VStack gap={4} style={cardBody} hAlign="stretch">
        <HStack gap={3} vAlign="start" hAlign="between">
          <VStack gap={1} style={cardBody}>
            <HStack gap={2} vAlign="center">
              <Text type="body" weight="semibold" display="block">
                {fund.name}
              </Text>
              {fund.closedAt ? <Badge label="Closed" variant="neutral" /> : null}
            </HStack>
            <Text type="supporting" color="secondary" display="block">
              {FUND_SOURCE_LABELS[fund.source]} · {fund.startsOn} to {fund.endsOn}
            </Text>
          </VStack>
        </HStack>

        <FundBalance summary={summary} bare />

        {isExpiring ? (
          <Banner
            status="warning"
            title={`${formatMoney(summary.availableCents)} unspent, ${remainingDays} days left`}
            description="Unspent money on this fund is lost when it closes, and departments cut next year’s allocation for clubs that underspend."
          />
        ) : null}

        {fund.restrictions ? (
          <Text type="supporting" color="secondary" display="block">
            {fund.restrictions}
          </Text>
        ) : null}
      </VStack>
    </Card>
  );
}

export function ExpensesView() {
  const {funds, total, isLoading, error} = useTreasury();
  const {activeClub} = useSession();
  const canCreate = useCan('expense:create');

  const [isFundOpen, setFundOpen] = useState(false);
  const [isRequestOpen, setRequestOpen] = useState(false);

  if (isLoading) {
    return (
      <VStack gap={4} style={page} hAlign="stretch">
        <Skeleton width={260} height={32} />
        <Skeleton height={120} />
        <Skeleton height={200} />
      </VStack>
    );
  }

  // Shown instead of the page, not above it. A failed load leaves every list
  // empty, and an empty treasury renders as "$0.00 available" - which is a
  // confident lie when the truth is that we could not reach the API. On a money
  // screen that is the single worst thing to get wrong.
  if (error) {
    return (
      <VStack gap={4} style={page} hAlign="stretch">
        <Banner
          status="error"
          title="Could not load this club’s treasury"
          description={error}
          endContent={
            <Button
              label="Retry"
              variant="secondary"
              onClick={() => window.location.reload()}
            />
          }
        />
      </VStack>
    );
  }

  return (
    <>
      <VStack gap={6} style={page} hAlign="stretch">
        <HStack gap={4} hAlign="between" vAlign="start">
          <VStack gap={1}>
            <Heading level={2}>Expenses</Heading>
            <Text type="body" color="secondary">
              What {activeClub?.name ?? 'the club'} was given, what it has asked
              for, and what is left to ask for.
            </Text>
          </VStack>

          {canCreate ? (
            <HStack gap={2}>
              <Button
                label="Add a fund"
                variant="secondary"
                onClick={() => setFundOpen(true)}
              />
              <Button
                label="File a request"
                variant="primary"
                onClick={() => setRequestOpen(true)}
              />
            </HStack>
          ) : null}
        </HStack>

        {funds.length === 0 ? (
          <Card padding={8}>
            <EmptyState
              icon={<Icon icon={BanknotesIcon} />}
              title="No funds set up yet"
              description="Start with the money the club has been given - a dean’s fund, dues, a sponsorship. Requests are then tracked against it, so the amount left to ask for is always current."
              actions={
                canCreate ? (
                  <Button
                    label="Add a fund"
                    variant="primary"
                    size="sm"
                    onClick={() => setFundOpen(true)}
                  />
                ) : undefined
              }
            />
          </Card>
        ) : (
          <>
            {/*
              The club-wide total, and only when there is more than one fund to
              total. With a single fund it is the same four numbers as the card
              directly below it, and repeating them teaches people to skim past
              the figures rather than read them.

              Worth one caveat when it does appear, and it is in
              `summarizeClub`: funds carry different restrictions, so this
              answers "how is the club doing" and is not the figure to check
              before filing a request. That one is on the fund.
            */}
            {funds.length > 1 ? (
              <VStack gap={2} hAlign="stretch">
                <Heading level={3}>Across every fund</Heading>
                <FundBalance summary={total} />
                <Text type="supporting" color="secondary">
                  Funds have different rules about what they may be spent on, so
                  check the fund itself before filing a request.
                </Text>
              </VStack>
            ) : null}

            <VStack gap={3} hAlign="stretch">
              <HStack gap={2} vAlign="center">
                <Heading level={3}>Funds</Heading>
                <Text type="supporting" color="secondary">
                  {funds.length} {funds.length === 1 ? 'fund' : 'funds'}
                </Text>
              </HStack>
              <VStack gap={3} hAlign="stretch">
                {funds.map((fund) => (
                  <FundCard key={fund.id} fund={fund} />
                ))}
              </VStack>
            </VStack>

            <RequestList />
          </>
        )}
      </VStack>

      {canCreate ? (
        <>
          <FundComposerDialog
            isOpen={isFundOpen}
            onClose={() => setFundOpen(false)}
          />
          <RequestComposerDialog
            isOpen={isRequestOpen}
            onClose={() => setRequestOpen(false)}
          />
        </>
      ) : null}
    </>
  );
}
