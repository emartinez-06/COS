'use client';

/**
 * What is left to ask for. Officers only - see the note in `home-view`.
 *
 * Two rules from `docs/TREASURY.md` are load-bearing here and neither is
 * negotiable on a summary surface:
 *
 * - **`FundBalance` stays the only thing that puts an amount on screen**, and
 *   it always renders all four numbers. A dashboard is exactly where the
 *   temptation to show a single confident "remaining" is strongest, and a
 *   treasurer who reads "$136.20 left" without seeing the $885.50 already
 *   promised has been misled by their own tool.
 * - **A failed load must not render zeroes.** An empty treasury and an
 *   unreachable API produce the same object, and "$0.00 available" is a
 *   confident lie rather than a visible error. The error branch replaces the
 *   figures instead of sitting above them.
 */

import {VStack} from '@astryxdesign/core/Stack';
import {Text} from '@astryxdesign/core/Text';
import {Skeleton} from '@astryxdesign/core/Skeleton';

import {useTreasury} from '../../lib/treasury-store';
import {FundBalance} from '../treasury/fund-balance';
import {CardShell} from './card-shell';
import {FundMeterBar} from './fund-meter-bar';

export function TreasuryCard() {
  const {funds, total, isLoading, error} = useTreasury();

  return (
    <CardShell
      title="Treasury"
      href="/expenses"
      actionLabel="Open the treasury"
      meta={
        isLoading || error
          ? undefined
          : `${funds.length} ${funds.length === 1 ? 'fund' : 'funds'}`
      }>
      {isLoading ? (
        <VStack gap={3} hAlign="stretch">
          <Skeleton height={10} />
          <Skeleton height={44} />
        </VStack>
      ) : error ? (
        <Text type="body" color="secondary">
          The treasury could not be loaded, so no balance is shown here.
        </Text>
      ) : funds.length === 0 ? (
        <Text type="body" color="secondary">
          No fund has been set up yet.
        </Text>
      ) : (
        <VStack gap={4} hAlign="stretch">
          {/*
            `total` folds every fund with the same `summarizeFund` the API
            tests and any future export use, so these cannot disagree. With one
            fund it is that fund; with several it is the club's whole position,
            which is the right altitude for a dashboard - the per-fund split is
            one click away on the treasury itself.
          */}
          <FundMeterBar summary={total} />
          <FundBalance summary={total} bare />
        </VStack>
      )}
    </CardShell>
  );
}
