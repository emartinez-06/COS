'use client';

/**
 * Set up a fund, and record the money that came with it.
 *
 * The opening amount is collected here but is **not** a field on the fund. It
 * is sent as a separate allocation entry immediately after the fund is created,
 * because that is the only way money ever enters a fund - see
 * `docs/TREASURY.md`. Asking for it on this form is a convenience for the
 * person; it is not a change to the model, and `fundDraftSchema` has nowhere to
 * put it.
 *
 * Validation goes through the same `fundDraftSchema` the API validates with, so
 * the two cannot disagree about what a valid period is.
 */

import {useEffect, useState, type CSSProperties} from 'react';
import {Banner} from '@astryxdesign/core/Banner';
import {Button} from '@astryxdesign/core/Button';
import type {DateRange} from '@astryxdesign/core/Calendar';
import {DateRangeInput} from '@astryxdesign/core/DateRangeInput';
import {Dialog, DialogHeader} from '@astryxdesign/core/Dialog';
import {Selector} from '@astryxdesign/core/Selector';
import {HStack, VStack} from '@astryxdesign/core/Stack';
import {Text} from '@astryxdesign/core/Text';
import {TextArea} from '@astryxdesign/core/TextArea';
import {TextInput} from '@astryxdesign/core/TextInput';
import type {FundSource} from '@cos/core';
import {FUND_SOURCE_LABELS, fundDraftSchema, fundSourceSchema} from '@cos/core';

import {useTreasury} from '../../lib/treasury-store';
import {MONEY_PARSE_MESSAGES, parseMoneyToCents} from '../../lib/money';

const body: CSSProperties = {
  paddingInline: 'var(--spacing-5)',
  paddingBlock: 'var(--spacing-4)',
  overflowY: 'auto',
};

const footer: CSSProperties = {
  paddingInline: 'var(--spacing-5)',
  paddingBlock: 'var(--spacing-3)',
};

const SOURCE_OPTIONS = fundSourceSchema.options.map((source) => ({
  value: source as string,
  label: FUND_SOURCE_LABELS[source],
}));

export function FundComposerDialog({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const {createFund, allocate} = useTreasury();

  const [name, setName] = useState('');
  const [source, setSource] = useState<FundSource>('university');
  /**
   * The fund's period, as one range rather than two fields.
   *
   * `DateRange` carries `ISODateString`s, which is the same `YYYY-MM-DD` shape
   * `isoDateSchema` validates, so the value goes to the API unconverted.
   */
  const [period, setPeriod] = useState<DateRange | null>(null);
  const [restrictions, setRestrictions] = useState('');
  const [opening, setOpening] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Re-seed on open so an abandoned fund does not leak into the next one.
  useEffect(() => {
    if (isOpen) {
      setName('');
      setSource('university');
      setPeriod(null);
      setRestrictions('');
      setOpening('');
      setErrors({});
      setError(null);
    }
  }, [isOpen]);

  async function submit() {
    setError(null);

    const parsed = fundDraftSchema.safeParse({
      name: name.trim(),
      source,
      startsOn: period?.start ?? '',
      endsOn: period?.end ?? '',
      restrictions: restrictions.trim(),
    });

    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join('.') || 'form';
        next[key] ??= issue.message;
      }
      setErrors(next);
      return;
    }

    // The opening amount is optional: a club may set up a fund before the
    // department has confirmed the number.
    let openingCents = 0;
    if (opening.trim() !== '') {
      const amount = parseMoneyToCents(opening);
      if (!amount.ok) {
        setErrors({opening: MONEY_PARSE_MESSAGES[amount.error ?? 'not-a-number']});
        return;
      }
      openingCents = amount.cents;
    }

    setErrors({});
    setIsSaving(true);
    try {
      const fund = await createFund(parsed.data);
      if (openingCents !== 0) {
        await allocate(fund.id, {
          amountCents: openingCents,
          note: 'Initial grant',
        });
      }
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Dialog
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      purpose="form"
      width={620}
      maxHeight="88vh">
      <DialogHeader
        title="Add a fund"
        subtitle="Where a pot of money came from, what it may be spent on, and when it runs out."
        onOpenChange={(open) => {
          if (!open) {
            onClose();
          }
        }}
      />

      <VStack gap={4} style={body} hAlign="stretch">
        {error ? <Banner status="error" title="Could not save" description={error} /> : null}

        <TextInput
          label="Name"
          isRequired
          value={name}
          onChange={setName}
          placeholder="Dean’s Fund 2026-27"
          status={errors.name ? {type: 'error', message: errors.name} : undefined}
        />

        <Selector
          label="Where it came from"
          value={source}
          options={SOURCE_OPTIONS}
          onChange={(value) => setSource(value as FundSource)}
        />

        {/*
          A date range rather than a semester picker, deliberately. The founding
          case is one grant spanning two semesters, and a semester dropdown
          cannot express it. See docs/TREASURY.md.
        */}
        <DateRangeInput
          label="Period"
          isRequired
          value={period}
          onChange={setPeriod}
          status={
            errors.startsOn || errors.endsOn
              ? {
                  type: 'error',
                  message: errors.endsOn ?? errors.startsOn ?? '',
                }
              : undefined
          }
        />

        <TextInput
          label="Opening amount"
          isOptional
          value={opening}
          onChange={setOpening}
          placeholder="1500.00"
          status={
            errors.opening ? {type: 'error', message: errors.opening} : undefined
          }
        />
        <Text type="supporting" color="secondary">
          Recorded as the first entry in this fund’s history rather than as a
          number on the fund, so a later change to it never erases what the club
          was originally given.
        </Text>

        <TextArea
          label="Restrictions"
          isOptional
          value={restrictions}
          onChange={setRestrictions}
          rows={3}
          placeholder="No alcohol. No gifts. Food only with prior approval."
          status={
            errors.restrictions
              ? {type: 'error', message: errors.restrictions}
              : undefined
          }
        />
        <Text type="supporting" color="secondary">
          In the funder’s own words. Shown when filing a request; not enforced.
        </Text>
      </VStack>

      <HStack gap={2} hAlign="end" style={footer}>
        <Button label="Cancel" variant="secondary" onClick={onClose} />
        <Button
          label="Add fund"
          variant="primary"
          isLoading={isSaving}
          onClick={() => void submit()}
        />
      </HStack>
    </Dialog>
  );
}
