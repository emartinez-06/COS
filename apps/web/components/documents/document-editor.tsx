'use client';

/**
 * The officer's editor for an authored document.
 *
 * The whole reason this component is more than a textarea and a save button is
 * the conflict case, so that is what its state is organised around.
 *
 * `expectedVersion` is the version this editor opened on, held from mount and
 * deliberately *not* refreshed from the store underneath the writer. When the
 * save comes back 409, three things have to be true at once, and each one is a
 * way this goes wrong if it is missed:
 *
 * 1. **The officer's text stays in the box.** They typed it; a conflict is not
 *    a reason to throw it away. This is why the conflict message is state
 *    beside the form rather than an error thrown out of it.
 * 2. **The message says what actually happened**, including the version the
 *    document is now at, so "someone else saved first" is a fact rather than a
 *    vague failure.
 * 3. **Reloading is an explicit choice.** Nothing is silently replaced, because
 *    silently replacing is the thing the version counter exists to prevent.
 *
 * Metadata - title, summary, section, published - is saved without a version.
 * The API does not bump the version for those, on purpose: making a rename
 * invalidate someone's in-progress edit trains people to click through the
 * conflict message without reading it.
 */

import {useEffect, useRef, useState, type CSSProperties} from 'react';
import {Banner} from '@astryxdesign/core/Banner';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {Selector} from '@astryxdesign/core/Selector';
import {HStack, VStack} from '@astryxdesign/core/Stack';
import {Text} from '@astryxdesign/core/Text';
import {TextArea} from '@astryxdesign/core/TextArea';
import {TextInput} from '@astryxdesign/core/TextInput';
import type {
  ClubDocumentDetail,
  DocumentPatch,
  DocumentSection,
  DocumentStatus,
} from '@cos/core';
import {
  ALL_DOCUMENT_SECTIONS,
  DOCUMENT_SECTION_LABELS,
  DocumentVersionConflictError,
  MAX_DOCUMENT_CONTENT_CHARS,
} from '@cos/core';

const editorBody: CSSProperties = {minWidth: 0};

const SECTION_OPTIONS = ALL_DOCUMENT_SECTIONS.map((section) => ({
  value: section as string,
  label: DOCUMENT_SECTION_LABELS[section],
}));

const STATUS_OPTIONS = [
  {value: 'draft', label: 'Draft - only officers can see it'},
  {value: 'published', label: 'Published - every member can read it'},
];

interface Conflict {
  currentVersion: number;
  expectedVersion: number;
}

interface DocumentEditorProps {
  document: ClubDocumentDetail;
  /** Applies the patch and returns the saved document. */
  onSave: (patch: DocumentPatch) => Promise<ClubDocumentDetail>;
  /** Re-reads the document from the API, discarding the local edit. */
  onReload: () => Promise<ClubDocumentDetail | null>;
  onDone: () => void;
}

export function DocumentEditor({
  document,
  onSave,
  onReload,
  onDone,
}: DocumentEditorProps) {
  // Seeded once. The document prop changes as the store re-reads, and letting
  // that flow back into the form would overwrite what someone is typing.
  const [expectedVersion] = useState(document.version);
  const [title, setTitle] = useState(document.title);
  const [summary, setSummary] = useState(document.summary);
  const [section, setSection] = useState<DocumentSection>(document.section);
  const [status, setStatus] = useState<DocumentStatus>(document.status);
  const [content, setContent] = useState(document.content ?? '');

  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isReloading, setIsReloading] = useState(false);

  const contentChanged = content !== (document.content ?? '');

  /**
   * Brings the conflict message to the officer instead of waiting for them to
   * find it.
   *
   * Found by using this: the message renders at the top of the editor and Save
   * is at the bottom of a form taller than the window, so on a real document
   * the click appeared to do nothing at all. A notice nobody sees is the same
   * as no notice, and this one is the difference between "your edit was
   * refused" and "this app lost my writing".
   */
  const noticeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!conflict && !error) {
      return;
    }
    noticeRef.current?.scrollIntoView({
      block: 'center',
      // Matched to the settings gear's rule: motion is opt-out, not assumed.
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth',
    });
  }, [conflict, error]);

  async function save() {
    const trimmed = title.trim();
    if (!trimmed) {
      setError('A document needs a title.');
      return;
    }

    setError(null);
    setConflict(null);
    setIsSaving(true);

    const patch: DocumentPatch = {
      title: trimmed,
      summary: summary.trim(),
      section,
      status,
      // Sent only when it actually changed, so a metadata-only save does not
      // write an identical revision into a history that is supposed to be a
      // record of what changed.
      ...(contentChanged ? {content, expectedVersion} : {}),
    };

    try {
      await onSave(patch);
      onDone();
    } catch (cause) {
      if (cause instanceof DocumentVersionConflictError) {
        setConflict({
          currentVersion: cause.currentVersion,
          expectedVersion: cause.expectedVersion,
        });
      } else {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      setIsSaving(false);
    }
  }

  /** Discards this edit and shows what is actually stored. */
  async function takeTheirs() {
    setIsReloading(true);
    try {
      await onReload();
      onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsReloading(false);
    }
  }

  return (
    <Card padding={6}>
      <VStack gap={4} style={editorBody} hAlign="stretch">
        {conflict ? (
          <Banner
            ref={noticeRef}
            status="warning"
            title="Someone else saved first"
            description={`You were editing version ${conflict.expectedVersion} and this document is now at version ${conflict.currentVersion}. Your writing is still here and nothing has been overwritten. Open their version in another tab to compare, or discard yours and start from theirs.`}
            endContent={
              <Button
                label="Discard mine, load theirs"
                variant="secondary"
                isLoading={isReloading}
                onClick={() => void takeTheirs()}
              />
            }
          />
        ) : null}

        {error ? (
          <Banner ref={noticeRef} status="error" title={error} />
        ) : null}

        <TextInput label="Title" isRequired value={title} onChange={setTitle} />

        <TextInput
          label="Summary"
          isOptional
          value={summary}
          onChange={setSummary}
          placeholder="One line, shown under the title in the hub."
        />

        {document.kind === 'text' ? (
          <TextArea
            label="Content"
            rows={22}
            value={content}
            onChange={setContent}
            maxLength={MAX_DOCUMENT_CONTENT_CHARS}
            description="Markdown is rendered when the document is read."
          />
        ) : (
          <Text type="supporting" color="secondary">
            This is an uploaded file. Its contents are replaced by uploading a
            new version, not by typing here.
          </Text>
        )}

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
