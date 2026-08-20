'use client';

/**
 * The officer's editor for a document's metadata: title, summary, section,
 * and publish status.
 *
 * Content used to live here too - a `TextArea` plus a conflict banner for the
 * case where someone else saved first. It moved to `DocumentCollabEditor`,
 * which is always mounted for a text document rather than toggled by an
 * "Edit" button, so this form no longer has anything to say about content at
 * all: it never sends `content` or `expectedVersion`, and there is
 * consequently nothing here that can 409. `DocumentVersionConflictError`
 * still exists in @cos/core for the REST path a non-browser writer (a future
 * importer, say) might still use, but this component no longer needs to
 * handle it.
 */

import {useState} from 'react';
import {Banner} from '@astryxdesign/core/Banner';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {Selector} from '@astryxdesign/core/Selector';
import {HStack, VStack} from '@astryxdesign/core/Stack';
import {TextInput} from '@astryxdesign/core/TextInput';
import type {ClubDocumentDetail, DocumentPatch, DocumentSection, DocumentStatus} from '@cos/core';
import {ALL_DOCUMENT_SECTIONS, DOCUMENT_SECTION_LABELS} from '@cos/core';

const SECTION_OPTIONS = ALL_DOCUMENT_SECTIONS.map((section) => ({
  value: section as string,
  label: DOCUMENT_SECTION_LABELS[section],
}));

const STATUS_OPTIONS = [
  {value: 'draft', label: 'Draft - only officers can see it'},
  {value: 'published', label: 'Published - every member can read it'},
];

interface DocumentEditorProps {
  document: ClubDocumentDetail;
  /** Applies the patch and returns the saved document. */
  onSave: (patch: DocumentPatch) => Promise<ClubDocumentDetail>;
  onDone: () => void;
}

export function DocumentEditor({document, onSave, onDone}: DocumentEditorProps) {
  const [title, setTitle] = useState(document.title);
  const [summary, setSummary] = useState(document.summary);
  const [section, setSection] = useState<DocumentSection>(document.section);
  const [status, setStatus] = useState<DocumentStatus>(document.status);

  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function save() {
    const trimmed = title.trim();
    if (!trimmed) {
      setError('A document needs a title.');
      return;
    }

    setError(null);
    setIsSaving(true);
    try {
      await onSave({title: trimmed, summary: summary.trim(), section, status});
      onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Card padding={6}>
      <VStack gap={4} hAlign="stretch">
        {error ? <Banner status="error" title={error} /> : null}

        <TextInput label="Title" isRequired value={title} onChange={setTitle} />

        <TextInput
          label="Summary"
          isOptional
          value={summary}
          onChange={setSummary}
          placeholder="One line, shown under the title in the hub."
        />

        <HStack gap={3}>
          <Selector
            label="Section"
            value={section}
            options={SECTION_OPTIONS}
            onChange={(value) => setSection((value ?? 'other') as DocumentSection)}
          />
          <Selector
            label="Visibility"
            value={status}
            options={STATUS_OPTIONS}
            onChange={(value) => setStatus((value ?? 'draft') as DocumentStatus)}
          />
        </HStack>

        <HStack gap={2} hAlign="end">
          <Button label="Cancel" variant="ghost" onClick={onDone} />
          <Button
            label="Save"
            variant="primary"
            isLoading={isSaving}
            onClick={() => void save()}
          />
        </HStack>
      </VStack>
    </Card>
  );
}
