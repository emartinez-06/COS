'use client';

/**
 * The treasury, embedded on the canvas.
 *
 * Reuses `useTreasury()` and `FundBalance`/`FundMeterBar` directly rather
 * than fetching or drawing a balance a second time - `FundBalance` already
 * supports `bare` for exactly this case, dropping cleanly into
 * `CanvasEmbedShell` without a second title wrapper.
 */

import {VStack} from '@astryxdesign/core/Stack';
import {Text} from '@astryxdesign/core/Text';
import {Skeleton} from '@astryxdesign/core/Skeleton';

import {useTreasury} from '../../../lib/treasury-store';
import {FundMeterBar} from '../../dashboard/fund-meter-bar';
import {FundBalance} from '../../treasury/fund-balance';
import type {EntityEmbedRendererProps} from '../entity-embed-registry';

export function CanvasExpensesEmbed(_props: EntityEmbedRendererProps) {
  const {funds, total, isLoading, error} = useTreasury();

  if (isLoading) {
    return (
      <VStack gap={3} hAlign="stretch">
        <Skeleton height={10} />
        <Skeleton height={44} />
      </VStack>
    );
  }

  if (error) {
    return (
      <Text type="body" color="secondary">
        The treasury could not be loaded.
      </Text>
    );
  }

  if (funds.length === 0) {
    return (
      <Text type="body" color="secondary">
        No fund has been set up yet.
      </Text>
    );
  }

  return (
    <VStack gap={4} hAlign="stretch">
      {/* `total` folds every fund with the same `summarizeFund` the API and
          any export use - with one fund it is that fund, with several it is
          the club's whole position. */}
      <FundMeterBar summary={total} />
      <FundBalance summary={total} bare />
    </VStack>
  );
}
