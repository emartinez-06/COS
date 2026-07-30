'use client';

/**
 * Create/edit an event.
 *
 * Validation is delegated to `eventDraftSchema` from @cos/core rather than
 * re-expressed here, so the form cannot drift from what the API will accept.
 * The schema's cross-field rule (end after start) is why errors are keyed by
 * path and rendered per field.
 */

import {useEffect, useMemo, useState, type CSSProperties} from 'react';
import {Dialog, DialogHeader} from '@astryxdesign/core/Dialog';
import {Button} from '@astryxdesign/core/Button';
import {Divider} from '@astryxdesign/core/Divider';
import {HStack, VStack} from '@astryxdesign/core/Stack';
import {Heading, Text} from '@astryxdesign/core/Text';
import {TextInput} from '@astryxdesign/core/TextInput';
import {TextArea} from '@astryxdesign/core/TextArea';
import {Selector} from '@astryxdesign/core/Selector';
import {DateTimeInput} from '@astryxdesign/core/DateTimeInput';
import {Icon} from '@astryxdesign/core/Icon';
import {PlusIcon, TrashIcon} from '@heroicons/react/24/outline';
import {
  CATEGORY_LABELS,
  type ClubEvent,
  type EventCategory,
  type EventDraft,
  type EventVisibility,
  eventCategorySchema,
  eventDraftSchema,
} from '@cos/core';
import {addHours, fromInputValue, toInputValue} from '../../lib/datetime';

const body: CSSProperties = {
  paddingInline: 'var(--spacing-5)',
  paddingBlock: 'var(--spacing-4)',
  overflowY: 'auto',
};

const footer: CSSProperties = {
  paddingInline: 'var(--spacing-5)',
  paddingBlock: 'var(--spacing-3)',
};

const CATEGORY_OPTIONS = eventCategorySchema.options.map((value) => ({
  value,
  label: CATEGORY_LABELS[value],
}));

const VISIBILITY_OPTIONS = [
  {value: 'members', label: 'Members only'},
  {value: 'public', label: 'Public - shown on the club page'},
];

/** Mutable mirror of EventDraft; strings so inputs stay controlled. */
interface FormState {
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
  location: string;
  speakerName: string;
  speakerTitle: string;
  speakerAffiliation: string;
  links: {label: string; url: string}[];
  category: EventCategory;
  visibility: EventVisibility;
}

function emptyForm(day: Date): FormState {
  // Default to an 18:00 start, the most common club meeting time, on the day
  // the officer clicked.
  const start = new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    18,
    0,
    0,
    0,
  ).toISOString();

  return {
    title: '',
    description: '',
    startsAt: start,
    endsAt: addHours(start, 1),
    location: '',
    speakerName: '',
    speakerTitle: '',
    speakerAffiliation: '',
    links: [],
    category: 'meeting',
    visibility: 'members',
  };
}

function formFromEvent(event: ClubEvent): FormState {
  return {
    title: event.title,
    description: event.description,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    location: event.location,
    speakerName: event.speaker?.name ?? '',
    speakerTitle: event.speaker?.title ?? '',
    speakerAffiliation: event.speaker?.affiliation ?? '',
    links: event.links.map((link) => ({...link})),
    category: event.category,
    visibility: event.visibility,
  };
}

/** Form state to the shape the schema validates. */
function toDraftInput(form: FormState) {
  const speakerName = form.speakerName.trim();
  return {
    title: form.title.trim(),
    description: form.description.trim(),
    startsAt: form.startsAt,
    endsAt: form.endsAt,
    location: form.location.trim(),
    speaker: speakerName
      ? {
          name: speakerName,
          title: form.speakerTitle.trim() || undefined,
          affiliation: form.speakerAffiliation.trim() || undefined,
        }
      : null,
    // Blank rows are scaffolding for the officer, not data.
    links: form.links.filter((link) => link.label.trim() && link.url.trim()),
    category: form.category,
    visibility: form.visibility,
  };
}

interface EventComposerDialogProps {
  isOpen: boolean;
  /** Present when editing; absent when creating. */
  event: ClubEvent | null;
  /** Day the officer clicked, used to seed a new event's date. */
  defaultDay: Date;
  onClose: () => void;
  onSubmit: (draft: EventDraft) => Promise<void>;
}

export function EventComposerDialog({
  isOpen,
  event,
  defaultDay,
  onClose,
  onSubmit,
}: EventComposerDialogProps) {
  const [form, setForm] = useState<FormState>(() =>
    event ? formFromEvent(event) : emptyForm(defaultDay),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);

  // Re-seed whenever the dialog opens so a cancelled edit does not leak into
  // the next one.
  useEffect(() => {
    if (isOpen) {
      setForm(event ? formFromEvent(event) : emptyForm(defaultDay));
      setErrors({});
    }
  }, [isOpen, event, defaultDay]);

  const patch = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({...current, [key]: value}));
  };

  const title = event ? 'Edit event' : 'New event';

  const handleSubmit = async () => {
    const parsed = eventDraftSchema.safeParse(toDraftInput(form));

    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join('.') || 'form';
        next[key] ??= issue.message;
      }
      setErrors(next);
      return;
    }

    setIsSaving(true);
    try {
      await onSubmit(parsed.data);
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  const startValue = useMemo(() => toInputValue(form.startsAt), [form.startsAt]);
  const endValue = useMemo(() => toInputValue(form.endsAt), [form.endsAt]);

  return (
    <Dialog
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      // 'form' keeps a stray backdrop click from discarding a half-typed event.
      purpose="form"
      width={620}
      maxHeight="88vh">
      <DialogHeader
        title={title}
        subtitle="Members see this on the club calendar as soon as you save."
        onOpenChange={(open) => {
          if (!open) {
            onClose();
          }
        }}
      />

      <VStack gap={4} style={body}>
        <TextInput
          label="Title"
          isRequired
          value={form.title}
          onChange={(value) => patch('title', value)}
          placeholder="Weekly Chapter Meeting"
          status={errors.title ? {type: 'error', message: errors.title} : undefined}
        />

        {/* Stacked, not side by side: each DateTimeInput renders a date *and* a
            time field, so a row of two overflows the dialog and clips the end
            time. */}
        <VStack gap={3}>
          <DateTimeInput
            label="Starts"
            isRequired
            value={startValue}
            onChange={(value) => {
              const iso = fromInputValue(value);
              if (!iso) {
                return;
              }
              setForm((current) => ({
                ...current,
                startsAt: iso,
                // Keep a sane duration when the start moves past the end.
                endsAt:
                  new Date(current.endsAt) <= new Date(iso)
                    ? addHours(iso, 1)
                    : current.endsAt,
              }));
            }}
            status={
              errors.startsAt ? {type: 'error', message: errors.startsAt} : undefined
            }
          />
          <DateTimeInput
            label="Ends"
            isRequired
            value={endValue}
            onChange={(value) => {
              const iso = fromInputValue(value);
              if (iso) {
                patch('endsAt', iso);
              }
            }}
            status={
              errors.endsAt ? {type: 'error', message: errors.endsAt} : undefined
            }
          />
        </VStack>

        <TextInput
          label="Location"
          isOptional
          value={form.location}
          onChange={(value) => patch('location', value)}
          placeholder="Rogers Engineering 109"
        />

        <TextArea
          label="Description"
          isOptional
          rows={4}
          maxLength={2000}
          value={form.description}
          onChange={(value) => patch('description', value)}
          placeholder="What members should know before showing up."
          status={
            errors.description
              ? {type: 'error', message: errors.description}
              : undefined
          }
        />

        <HStack gap={3}>
          <Selector
            label="Category"
            value={form.category}
            options={CATEGORY_OPTIONS}
            onChange={(value) => patch('category', value as EventCategory)}
          />
          <Selector
            label="Visibility"
            value={form.visibility}
            options={VISIBILITY_OPTIONS}
            onChange={(value) => patch('visibility', value as EventVisibility)}
          />
        </HStack>

        <Divider />

        <VStack gap={3}>
          <Heading level={4}>Speaker</Heading>
          <Text type="supporting" color="secondary">
            Leave the name blank if the event has no speaker.
          </Text>
          <TextInput
            label="Speaker name"
            isOptional
            value={form.speakerName}
            onChange={(value) => patch('speakerName', value)}
            placeholder="Priya Raghavan"
          />
          <HStack gap={3}>
            <TextInput
              label="Title"
              isOptional
              value={form.speakerTitle}
              onChange={(value) => patch('speakerTitle', value)}
              placeholder="Staff Engineer"
              isDisabled={!form.speakerName.trim()}
            />
            <TextInput
              label="Affiliation"
              isOptional
              value={form.speakerAffiliation}
              onChange={(value) => patch('speakerAffiliation', value)}
              placeholder="Datadog"
              isDisabled={!form.speakerName.trim()}
            />
          </HStack>
        </VStack>

        <Divider />

        <VStack gap={3}>
          <HStack hAlign="between" vAlign="center">
            <Heading level={4}>Links</Heading>
            <Button
              label="Add link"
              variant="ghost"
              size="sm"
              icon={<Icon icon={PlusIcon} size="sm" />}
              onClick={() =>
                patch('links', [...form.links, {label: '', url: ''}])
              }
            />
          </HStack>

          {form.links.length === 0 && (
            <Text type="supporting" color="secondary">
              RSVP forms, slides, and sign-up sheets. These are included in the
              GroupMe announcement.
            </Text>
          )}

          {form.links.map((link, index) => (
            <HStack key={index} gap={2} vAlign="end">
              <TextInput
                label="Label"
                isLabelHidden
                value={link.label}
                placeholder="RSVP"
                onChange={(value) =>
                  patch(
                    'links',
                    form.links.map((item, i) =>
                      i === index ? {...item, label: value} : item,
                    ),
                  )
                }
              />
              <TextInput
                label="URL"
                isLabelHidden
                value={link.url}
                placeholder="https://example.com/rsvp"
                onChange={(value) =>
                  patch(
                    'links',
                    form.links.map((item, i) =>
                      i === index ? {...item, url: value} : item,
                    ),
                  )
                }
                status={
                  errors[`links.${index}.url`]
                    ? {type: 'error', message: errors[`links.${index}.url`] ?? ''}
                    : undefined
                }
              />
              <Button
                label={`Remove link ${index + 1}`}
                variant="ghost"
                size="sm"
                isIconOnly
                icon={<Icon icon={TrashIcon} size="sm" />}
                onClick={() =>
                  patch(
                    'links',
                    form.links.filter((_, i) => i !== index),
                  )
                }
              />
            </HStack>
          ))}
        </VStack>
      </VStack>

      <Divider />

      <HStack gap={2} hAlign="end" style={footer}>
        <Button label="Cancel" variant="ghost" onClick={onClose} />
        <Button
          label={event ? 'Save changes' : 'Create event'}
          variant="primary"
          isLoading={isSaving}
          onClick={() => void handleSubmit()}
        />
      </HStack>
    </Dialog>
  );
}
