'use client';

/**
 * File a request: the university's form, as the club fills it in.
 *
 * Two things here are not obvious and are both deliberate.
 *
 * **It opens on "already submitted".** The common path is a treasurer recording
 * something they have *already* sent to the department, not drafting it here
 * first. Defaulting to draft would mean every real request needs a second
 * action, and a queue of "drafts" that were in fact submitted weeks ago is worse
 * than no status at all.
 *
 * **The fund's restrictions are shown next to the amount**, not hidden behind
 * the fund picker. "No alcohol, no gifts" is the thing a treasurer needs while
 * writing the justification, and a rule nobody reads at the moment of writing
 * is a rule that gets broken and then refused by the department a week later.
 *
 * ## Field order is deliberate, and was fixed by looking at it
 *
 * Status sits above the justification even though it reads like a footnote,
 * because it is the control that decides whether this money is committed. It
 * was originally last, which put it below the fold on a laptop while the "File
 * request" button stayed visible - so a treasurer could file a request, never
 * having seen that it defaulted to "already sent", and watch the fund lose $400
 * they had not spent. The rule this follows: a one-line control that changes
 * the arithmetic outranks a large optional textarea.
 */

import {useEffect, useMemo, useState, type CSSProperties} from 'react';
import {Banner} from '@astryxdesign/core/Banner';
import {Button} from '@astryxdesign/core/Button';
import type {ISODateString} from '@astryxdesign/core/Calendar';
import {DateInput} from '@astryxdesign/core/DateInput';
import {Dialog, DialogHeader} from '@astryxdesign/core/Dialog';
import {Selector} from '@astryxdesign/core/Selector';
import {HStack, VStack} from '@astryxdesign/core/Stack';
import {Text} from '@astryxdesign/core/Text';
import {TextArea} from '@astryxdesign/core/TextArea';
import {TextInput} from '@astryxdesign/core/TextInput';
import type {ExpenseCategory, RequestStatus} from '@cos/core';
import {
  EXPENSE_CATEGORY_LABELS,
  expenseCategorySchema,
  expenseRequestDraftSchema,
  formatMoney,
} from '@cos/core';

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

const CATEGORY_OPTIONS = expenseCategorySchema.options.map((category) => ({
  value: category as string,
  label: EXPENSE_CATEGORY_LABELS[category],
}));

const STATUS_OPTIONS = [
  {value: 'submitted', label: 'Already sent to the university'},
  {value: 'draft', label: 'Still a draft - not sent yet'},
];

export function RequestComposerDialog({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const {funds, createRequest, summaryFor} = useTreasury();

  const openFunds = useMemo(
    () => funds.filter((fund) => fund.closedAt === null),
    [funds],
  );

  const [fundId, setFundId] = useState('');
  const [title, setTitle] = useState('');
  const [justification, setJustification] = useState('');
  const [category, setCategory] = useState<ExpenseCategory>('other');
  const [amount, setAmount] = useState('');
  const [neededBy, setNeededBy] = useState<ISODateString | undefined>(undefined);
  const [status, setStatus] = useState<RequestStatus>('submitted');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setFundId(openFunds[0]?.id ?? '');
      setTitle('');
      setJustification('');
      setCategory('other');
      setAmount('');
      setNeededBy(undefined);
      setStatus('submitted');
      setErrors({});
      setError(null);
    }
  }, [isOpen, openFunds]);

  const fund = openFunds.find((entry) => entry.id === fundId) ?? null;
  const summary = fund ? summaryFor(fund.id) : null;

  /**
   * What this request would leave available, live as the amount is typed.
   *
   * The single most useful thing this dialog can say. Committing $400 against
   * $221 left is the mistake the whole model exists to prevent, and the moment
   * to say so is while the number is being typed - not after the department
   * refuses it.
   */
  const projected = useMemo(() => {
    if (!summary) {
      return null;
    }
    const parsed = parseMoneyToCents(amount);
    if (!parsed.ok || status === 'draft') {
      return null;
    }
    return summary.availableCents - parsed.cents;
  }, [summary, amount, status]);

  async function submit() {
    setError(null);

    const parsedAmount = parseMoneyToCents(amount);
    if (!parsedAmount.ok) {
      setErrors({
        requestedAmountCents:
          MONEY_PARSE_MESSAGES[parsedAmount.error ?? 'not-a-number'],
      });
      return;
    }

    const parsed = expenseRequestDraftSchema.safeParse({
      fundId,
      title: title.trim(),
      justification: justification.trim(),
      category,
      requestedAmountCents: parsedAmount.cents,
      neededBy: neededBy ?? null,
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

    setErrors({});
    setIsSaving(true);
    try {
      await createRequest(parsed.data, status);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsSaving(false);
    }
  }

  const hasFunds = openFunds.length > 0;

  return (
    <Dialog
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      purpose="form"
      width={640}
      maxHeight="88vh">
      <DialogHeader
        title="File a request"
        subtitle="What the club is asking the university to buy, and why."
        onOpenChange={(open) => {
          if (!open) {
            onClose();
          }
        }}
      />

      <VStack gap={4} style={body} hAlign="stretch">
        {error ? (
          <Banner status="error" title="Could not save" description={error} />
        ) : null}

        {!hasFunds ? (
          <Banner
            status="info"
            title="There is no open fund to draw from"
            description="Add a fund first - a request has to come out of somewhere, and the fund is what decides how much is left."
          />
        ) : null}

        <Selector
          label="Fund"
          value={fundId}
          options={openFunds.map((entry) => ({
            value: entry.id,
            label: entry.name,
          }))}
          onChange={setFundId}
        />

        {fund?.restrictions ? (
          <Banner
            status="info"
            title="What this fund may not be spent on"
            description={fund.restrictions}
          />
        ) : null}

        <TextInput
          label="What is it for"
          isRequired
          value={title}
          onChange={setTitle}
          placeholder="Pizza for the October general meeting"
          status={errors.title ? {type: 'error', message: errors.title} : undefined}
        />

        <HStack gap={3} vAlign="end">
          <TextInput
            label="Amount"
            isRequired
            value={amount}
            onChange={setAmount}
            placeholder="120.00"
            status={
              errors.requestedAmountCents
                ? {type: 'error', message: errors.requestedAmountCents}
                : undefined
            }
          />
          <Selector
            label="Category"
            value={category}
            options={CATEGORY_OPTIONS}
            onChange={(value) => setCategory(value as ExpenseCategory)}
          />
        </HStack>

        {summary ? (
          <Text
            type="supporting"
            display="block"
            style={
              projected !== null && projected < 0
                ? {color: 'var(--color-error)'}
                : {color: 'var(--color-text-secondary)'}
            }>
            {formatMoney(summary.availableCents)} available in this fund
            {projected === null
              ? ''
              : projected < 0
                ? ` - this request would put it ${formatMoney(Math.abs(projected))} over`
                : ` - this would leave ${formatMoney(projected)}`}
          </Text>
        ) : null}

        <HStack gap={3} vAlign="end">
          <DateInput
            label="Needed by"
            isOptional
            value={neededBy}
            onChange={setNeededBy}
            status={
              errors.neededBy ? {type: 'error', message: errors.neededBy} : undefined
            }
          />
          <Selector
            label="Status"
            value={status}
            options={STATUS_OPTIONS}
            onChange={(value) => setStatus(value as RequestStatus)}
          />
        </HStack>
        <Text type="supporting" color="secondary">
          A submitted request is counted as committed straight away, so the fund
          stops offering money that is already spoken for.
        </Text>

        <TextArea
          label="Justification"
          isOptional
          value={justification}
          onChange={setJustification}
          rows={4}
          placeholder="How this furthers the club’s purpose - the part the department actually reads."
          status={
            errors.justification
              ? {type: 'error', message: errors.justification}
              : undefined
          }
        />

      </VStack>

      <HStack gap={2} hAlign="end" style={footer}>
        <Button label="Cancel" variant="secondary" onClick={onClose} />
        <Button
          label="File request"
          variant="primary"
          isLoading={isSaving}
          isDisabled={!hasFunds}
          onClick={() => void submit()}
        />
      </HStack>
    </Dialog>
  );
}
