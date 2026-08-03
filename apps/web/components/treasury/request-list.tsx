'use client';

/**
 * The club's requests, and the controls for recording what became of them.
 *
 * Every transition here is the treasurer writing down something that already
 * happened at the university. Nothing in this list sends anything to anyone,
 * and the wording is chosen to say so - "Mark purchased", not "Purchase".
 *
 * Requests still in flight are listed first regardless of age, because they are
 * the ones that need a human. A settled request is history; a submitted one
 * three weeks old is a phone call somebody has to make.
 */

import {useMemo, useState, type CSSProperties} from 'react';
import {Badge} from '@astryxdesign/core/Badge';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {EmptyState} from '@astryxdesign/core/EmptyState';
import {Icon} from '@astryxdesign/core/Icon';
import {HStack, VStack} from '@astryxdesign/core/Stack';
import {Heading, Text} from '@astryxdesign/core/Text';
import {TextInput} from '@astryxdesign/core/TextInput';
import {InboxIcon} from '@heroicons/react/24/outline';
import type {ExpenseRequest, Fund, RequestStatus} from '@cos/core';
import {
  EXPENSE_CATEGORY_LABELS,
  REQUEST_STATUS_LABELS,
  formatMoney,
  isRequestOpen,
} from '@cos/core';

import {useTreasury} from '../../lib/treasury-store';
import {MONEY_PARSE_MESSAGES, parseMoneyToCents} from '../../lib/money';

const cardBody: CSSProperties = {minWidth: 0};
const titleText: CSSProperties = {overflowWrap: 'anywhere'};

/** Astryx `Badge` variants, chosen so "needs attention" reads at a glance. */
const STATUS_VARIANT: Record<
  RequestStatus,
  'neutral' | 'warning' | 'success' | 'error'
> = {
  draft: 'neutral',
  submitted: 'warning',
  approved: 'warning',
  purchased: 'success',
  settled: 'success',
  denied: 'error',
  cancelled: 'neutral',
};

/** Whole days since an instant, for the staleness note. */
function daysSince(iso: string): number {
  const then = new Date(iso).getTime();
  return Math.floor((Date.now() - then) / (1000 * 60 * 60 * 24));
}

/**
 * How long this has been sitting with the university, when that is worth
 * saying. Chasing an administrator is a real part of the job and nothing else
 * in the product reminds anyone to do it.
 */
function waitingNote(request: ExpenseRequest): string | null {
  if (!isRequestOpen(request.status) || !request.submittedAt) {
    return null;
  }
  const days = daysSince(request.submittedAt);
  if (days < 14) {
    return null;
  }
  return `Sent ${days} days ago with no outcome recorded`;
}

function RequestCard({
  request,
  fund,
}: {
  request: ExpenseRequest;
  fund: Fund | undefined;
}) {
  const {updateRequest, removeRequest} = useTreasury();

  const [isBusy, setBusy] = useState(false);
  const [actualInput, setActualInput] = useState('');
  const [isRecording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function move(status: RequestStatus, actualAmountCents?: number) {
    setBusy(true);
    setError(null);
    try {
      await updateRequest(request.id, {
        status,
        ...(actualAmountCents === undefined ? {} : {actualAmountCents}),
      });
      setRecording(false);
      setActualInput('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function recordPurchase() {
    // The confirmed price is optional: an order confirmation sometimes arrives
    // before the amount does. Leaving it blank keeps the request on the books
    // at what was asked for rather than dropping it to zero.
    if (actualInput.trim() === '') {
      await move('purchased');
      return;
    }
    const parsed = parseMoneyToCents(actualInput);
    if (!parsed.ok) {
      setError(MONEY_PARSE_MESSAGES[parsed.error ?? 'not-a-number']);
      return;
    }
    await move('purchased', parsed.cents);
  }

  const waiting = waitingNote(request);
  const spentAmount = request.actualAmountCents ?? request.requestedAmountCents;
  const isSettled = request.status === 'purchased' || request.status === 'settled';

  return (
    <Card padding={4}>
      <VStack gap={3} style={cardBody} hAlign="stretch">
        <HStack gap={3} vAlign="start" hAlign="between">
          <VStack gap={1} style={cardBody}>
            <Text type="body" weight="semibold" display="block" style={titleText}>
              {request.title}
            </Text>
            <Text type="supporting" color="secondary" display="block">
              {[
                fund?.name ?? 'Unknown fund',
                EXPENSE_CATEGORY_LABELS[request.category],
                request.neededBy ? `needed by ${request.neededBy}` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </VStack>

          <VStack gap={1} hAlign="end">
            <Text type="body" weight="semibold" display="block">
              {formatMoney(isSettled ? spentAmount : request.requestedAmountCents)}
            </Text>
            <Badge
              label={REQUEST_STATUS_LABELS[request.status]}
              variant={STATUS_VARIANT[request.status]}
            />
          </VStack>
        </HStack>

        {/*
          Shown only when the two differ. A confirmation that matched the ask is
          not news; one that came in $2.17 under is what makes the books add up.
        */}
        {isSettled &&
        request.actualAmountCents !== null &&
        request.actualAmountCents !== request.requestedAmountCents ? (
          <Text type="supporting" color="secondary" display="block">
            Asked for {formatMoney(request.requestedAmountCents)}
          </Text>
        ) : null}

        {waiting ? (
          <Text type="supporting" display="block" style={{color: 'var(--color-error)'}}>
            {waiting}
          </Text>
        ) : null}

        {request.justification ? (
          <Text type="supporting" color="secondary" display="block">
            {request.justification}
          </Text>
        ) : null}

        {request.decisionNote ? (
          <Text type="supporting" color="secondary" display="block">
            Department said: {request.decisionNote}
          </Text>
        ) : null}

        {error ? (
          <Text type="supporting" display="block" style={{color: 'var(--color-error)'}}>
            {error}
          </Text>
        ) : null}

        {isRecording ? (
          <HStack gap={2} vAlign="end">
            <TextInput
              label="What it actually cost"
              isOptional
              value={actualInput}
              onChange={setActualInput}
              placeholder={(request.requestedAmountCents / 100).toFixed(2)}
            />
            <Button
              label="Save"
              variant="primary"
              size="sm"
              isLoading={isBusy}
              onClick={() => void recordPurchase()}
            />
            <Button
              label="Cancel"
              variant="secondary"
              size="sm"
              onClick={() => setRecording(false)}
            />
          </HStack>
        ) : (
          <HStack gap={2} hAlign="start">
            {request.status === 'draft' ? (
              <>
                <Button
                  label="Mark sent"
                  variant="primary"
                  size="sm"
                  isLoading={isBusy}
                  onClick={() => void move('submitted')}
                />
                <Button
                  label="Delete"
                  variant="secondary"
                  size="sm"
                  isLoading={isBusy}
                  onClick={() => void removeRequest(request.id)}
                />
              </>
            ) : null}

            {request.status === 'submitted' ? (
              <>
                <Button
                  label="Mark approved"
                  variant="secondary"
                  size="sm"
                  isLoading={isBusy}
                  onClick={() => void move('approved')}
                />
                <Button
                  label="Mark purchased"
                  variant="primary"
                  size="sm"
                  onClick={() => setRecording(true)}
                />
                <Button
                  label="Mark denied"
                  variant="secondary"
                  size="sm"
                  isLoading={isBusy}
                  onClick={() => void move('denied')}
                />
              </>
            ) : null}

            {request.status === 'approved' ? (
              <>
                <Button
                  label="Mark purchased"
                  variant="primary"
                  size="sm"
                  onClick={() => setRecording(true)}
                />
                <Button
                  label="Mark denied"
                  variant="secondary"
                  size="sm"
                  isLoading={isBusy}
                  onClick={() => void move('denied')}
                />
              </>
            ) : null}

            {request.status === 'purchased' ? (
              <Button
                label="Mark settled"
                variant="secondary"
                size="sm"
                isLoading={isBusy}
                onClick={() => void move('settled')}
              />
            ) : null}

            {isRequestOpen(request.status) ? (
              <Button
                label="Withdraw"
                variant="secondary"
                size="sm"
                isLoading={isBusy}
                onClick={() => void move('cancelled')}
              />
            ) : null}
          </HStack>
        )}
      </VStack>
    </Card>
  );
}

export function RequestList() {
  const {requests, funds} = useTreasury();

  const fundsById = useMemo(
    () => new Map(funds.map((fund) => [fund.id, fund])),
    [funds],
  );

  /**
   * In flight first, then everything else, each newest first.
   *
   * The list already arrives newest-first from the API; this only lifts the
   * open ones, so a settled request from yesterday does not sit above a
   * submitted one from three weeks ago that nobody has chased.
   */
  const ordered = useMemo(() => {
    const open = requests.filter((entry) => isRequestOpen(entry.status));
    const rest = requests.filter((entry) => !isRequestOpen(entry.status));
    return [...open, ...rest];
  }, [requests]);

  return (
    <VStack gap={3} hAlign="stretch">
      <HStack gap={2} vAlign="center">
        <Heading level={3}>Requests</Heading>
        <Text type="supporting" color="secondary">
          {requests.length === 0
            ? 'Nothing filed yet'
            : `${requests.length} ${requests.length === 1 ? 'request' : 'requests'}`}
        </Text>
      </HStack>

      {requests.length === 0 ? (
        <Card padding={8}>
          <EmptyState
            icon={<Icon icon={InboxIcon} />}
            title="No requests yet"
            description="When the club asks the university to buy something, record it here. It counts against the fund from the moment it is sent, not when it arrives."
          />
        </Card>
      ) : (
        <VStack gap={2} hAlign="stretch">
          {ordered.map((request) => (
            <RequestCard
              key={request.id}
              request={request}
              fund={fundsById.get(request.fundId)}
            />
          ))}
        </VStack>
      )}
    </VStack>
  );
}
