'use client';

/**
 * Add a document: write one here, or upload one the club already has.
 *
 * One dialog with two modes rather than two dialogs, mirroring the API, which
 * has one create endpoint that branches on content type. The fields either side
 * of the body are identical - a title, a summary, a section, and whether it is
 * published - so splitting them would have been two copies of the same form.
 *
 * Validation goes through the same schemas the API validates with, and an
 * upload goes through the same `checkDocumentUpload` the API applies. That is
 * the point of those living in @cos/core: the browser refuses a 40 MB file
 * before spending a minute sending it, and the answer it gives cannot disagree
 * with the one the server would have given.
 */

import {useEffect, useState, type CSSProperties} from 'react';
import {useRouter} from 'next/navigation';
import {Banner} from '@astryxdesign/core/Banner';
import {Button} from '@astryxdesign/core/Button';
import {Dialog, DialogHeader} from '@astryxdesign/core/Dialog';
import {Divider} from '@astryxdesign/core/Divider';
import {FileInput} from '@astryxdesign/core/FileInput';
import {Selector} from '@astryxdesign/core/Selector';
import {HStack, VStack} from '@astryxdesign/core/Stack';
import {Text} from '@astryxdesign/core/Text';
import {TextArea} from '@astryxdesign/core/TextArea';
import {TextInput} from '@astryxdesign/core/TextInput';
import type {DocumentSection, DocumentStatus} from '@cos/core';
import {
  ALLOWED_DOCUMENT_CONTENT_TYPES,
  ALL_DOCUMENT_SECTIONS,
  DOCUMENT_SECTION_LABELS,
  MAX_DOCUMENT_CONTENT_CHARS,
  MAX_DOCUMENT_FILE_BYTES,
  UPLOAD_REJECTION_MESSAGES,
  checkDocumentUpload,
  fileDocumentDraftSchema,
  textDocumentDraftSchema,
} from '@cos/core';

import {useDocuments} from '../../lib/document-store';

const body: CSSProperties = {
  paddingInline: 'var(--spacing-5)',
  paddingBlock: 'var(--spacing-4)',
  overflowY: 'auto',
};

const footer: CSSProperties = {
  paddingInline: 'var(--spacing-5)',
  paddingBlock: 'var(--spacing-3)',
};

const SECTION_OPTIONS = ALL_DOCUMENT_SECTIONS.map((section) => ({
  value: section as string,
  label: DOCUMENT_SECTION_LABELS[section],
}));

const STATUS_OPTIONS = [
  {value: 'draft', label: 'Draft - only officers can see it'},
  {value: 'published', label: 'Published - every member can read it'},
];

/** The `accept` attribute, derived from the allowlist rather than retyped. */
const ACCEPT = ALLOWED_DOCUMENT_CONTENT_TYPES.join(',');

interface DocumentComposerDialogProps {
  isOpen: boolean;
  /** Which mode the dialog opens in. The officer can still switch. */
  kind: 'text' | 'file';
  onClose: () => void;
}

export function DocumentComposerDialog({
  isOpen,
  kind,
  onClose,
}: DocumentComposerDialogProps) {
  const {createDocument} = useDocuments();
  const router = useRouter();

  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [section, setSection] = useState<DocumentSection>('other');
  const [status, setStatus] = useState<DocumentStatus>('draft');
  const [content, setContent] = useState('');
  const [file, setFile] = useState<File | null>(null);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Re-seed on open so a cancelled document does not leak into the next one.
  useEffect(() => {
    if (isOpen) {
      setTitle('');
      setSummary('');
      setSection('other');
      setStatus('draft');
      setContent('');
      setFile(null);
      setErrors({});
      setError(null);
    }
  }, [isOpen, kind]);

  const isUpload = kind === 'file';

  async function submit() {
    setError(null);

    const shared = {
      // Falling back to the filename is what the API does when the title field
      // is empty, and doing it here too means the officer sees the title they
      // are about to get rather than finding out after the upload.
      title: title.trim() || (isUpload ? (file?.name ?? '') : ''),
      summary: summary.trim(),
      section,
      status,
    };

    const parsed = isUpload
      ? fileDocumentDraftSchema.safeParse({kind: 'file', ...shared})
      : textDocumentDraftSchema.safeParse({kind: 'text', ...shared, content});

    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join('.') || 'form';
        next[key] ??= issue.message;
      }
      setErrors(next);
      return;
    }

    if (isUpload) {
      if (!file) {
        setErrors({file: 'Choose a file to upload.'});
        return;
      }
      const check = checkDocumentUpload({
        contentType: file.type,
        byteSize: file.size,
      });
      if (!check.ok) {
        setErrors({file: UPLOAD_REJECTION_MESSAGES[check.reason]});
        return;
      }
    }

    setErrors({});
    setIsSaving(true);
    try {
      const created = await createDocument(
        parsed.data,
        isUpload && file ? file : undefined,
      );
      onClose();
      // Straight to what was just made, so the officer sees the result of the
      // save rather than having to find it in the hub.
      router.push(`/documents/${encodeURIComponent(created.id)}`);
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
      // 'form' keeps a stray backdrop click from discarding half a document.
      purpose="form"
      width={640}
      maxHeight="88vh">
      <DialogHeader
        title={isUpload ? 'Upload a file' : 'Write a document'}
        subtitle={
          isUpload
            ? 'A PDF, a scan, a spreadsheet - anything the club already has as a file.'
            : 'Authored here, so every edit is kept and the club can see what changed.'
        }
        onOpenChange={(open) => {
          if (!open) {
            onClose();
          }
        }}
      />

      <VStack gap={4} style={body} hAlign="stretch">
        <TextInput
          label="Title"
          isRequired={!isUpload}
          isOptional={isUpload}
          value={title}
          onChange={setTitle}
          placeholder={isUpload ? 'Defaults to the filename' : 'Club constitution'}
          status={errors.title ? {type: 'error', message: errors.title} : undefined}
        />

        <TextInput
          label="Summary"
          isOptional
          value={summary}
          onChange={setSummary}
          placeholder="One line, shown under the title in the hub."
          status={
            errors.summary ? {type: 'error', message: errors.summary} : undefined
          }
        />

        {isUpload ? (
          <FileInput
            label="File"
            isRequired
            mode="dropzone"
            value={file}
            accept={ACCEPT}
            maxSize={MAX_DOCUMENT_FILE_BYTES}
            onChange={(chosen) => {
              setFile(Array.isArray(chosen) ? (chosen[0] ?? null) : chosen);
              setErrors((current) => ({...current, file: ''}));
            }}
            description="PDF, Word, Excel, PowerPoint, plain text, CSV, PNG or JPEG, up to 25 MB."
            status={errors.file ? {type: 'error', message: errors.file} : undefined}
          />
        ) : (
          <TextArea
            label="Content"
            rows={14}
            value={content}
            onChange={setContent}
            maxLength={MAX_DOCUMENT_CONTENT_CHARS}
            placeholder={'# Article I\n\nMarkdown works here.'}
            description="Markdown is rendered when the document is read."
            status={
              errors.content ? {type: 'error', message: errors.content} : undefined
            }
          />
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

        {status === 'draft' ? (
          <Text type="supporting" color="secondary">
            Drafts are visible to officers only. Publish it when it is ready and
            every member sees it immediately.
          </Text>
        ) : null}

        {error ? <Banner status="error" title={error} /> : null}
      </VStack>

      <Divider />

      <HStack gap={2} hAlign="end" style={footer}>
        <Button label="Cancel" variant="ghost" onClick={onClose} />
        <Button
          label={isUpload ? 'Upload' : 'Create document'}
          variant="primary"
          isLoading={isSaving}
          onClick={() => void submit()}
        />
      </HStack>
    </Dialog>
  );
}
