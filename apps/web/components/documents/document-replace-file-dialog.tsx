'use client';

/**
 * Replacing an uploaded document's bytes with a newer file.
 *
 * The replacement is a new revision, never an overwrite: each file revision has
 * its own storage key, so last term's signed constitution is still downloadable
 * from the history after this term's is uploaded. That is a property of the
 * storage layer, and this dialog's job is to not imply otherwise - hence
 * "Upload a new version" rather than "Replace".
 *
 * Carries `expectedVersion` for the same reason the text editor does, and shows
 * the same conflict outcome. Two officers replacing the same form on the same
 * afternoon is exactly the case the version counter exists for.
 */

import {useEffect, useState, type CSSProperties} from 'react';
import {Banner} from '@astryxdesign/core/Banner';
import {Button} from '@astryxdesign/core/Button';
import {Dialog, DialogHeader} from '@astryxdesign/core/Dialog';
import {Divider} from '@astryxdesign/core/Divider';
import {FileInput} from '@astryxdesign/core/FileInput';
import {HStack, VStack} from '@astryxdesign/core/Stack';
import {Text} from '@astryxdesign/core/Text';
import type {ClubDocumentDetail} from '@cos/core';
import {
  ALLOWED_DOCUMENT_CONTENT_TYPES,
  DocumentVersionConflictError,
  MAX_DOCUMENT_FILE_BYTES,
  UPLOAD_REJECTION_MESSAGES,
  checkDocumentUpload,
} from '@cos/core';

import {useDocuments} from '../../lib/document-store';

const body: CSSProperties = {
  paddingInline: 'var(--spacing-5)',
  paddingBlock: 'var(--spacing-4)',
};

const footer: CSSProperties = {
  paddingInline: 'var(--spacing-5)',
  paddingBlock: 'var(--spacing-3)',
};

const ACCEPT = ALLOWED_DOCUMENT_CONTENT_TYPES.join(',');

interface DocumentReplaceFileDialogProps {
  isOpen: boolean;
  document: ClubDocumentDetail;
  onClose: () => void;
  onReplaced: (updated: ClubDocumentDetail) => void;
}

export function DocumentReplaceFileDialog({
  isOpen,
  document,
  onClose,
  onReplaced,
}: DocumentReplaceFileDialogProps) {
  const {replaceFile} = useDocuments();

  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setFile(null);
      setFileError(null);
      setError(null);
      setConflict(null);
    }
  }, [isOpen]);

  async function submit() {
    if (!file) {
      setFileError('Choose the file to upload.');
      return;
    }

    const check = checkDocumentUpload({
      contentType: file.type,
      byteSize: file.size,
    });
    if (!check.ok) {
      setFileError(UPLOAD_REJECTION_MESSAGES[check.reason]);
      return;
    }

    setFileError(null);
    setError(null);
    setConflict(null);
    setIsSaving(true);

    try {
      onReplaced(await replaceFile(document.id, file, document.version));
      onClose();
    } catch (cause) {
      if (cause instanceof DocumentVersionConflictError) {
        setConflict(cause.currentVersion);
      } else {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
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
      width={560}>
      <DialogHeader
        title="Upload a new version"
        subtitle={`${document.title} is at version ${document.version}. The file it has now is kept and stays downloadable from the history.`}
        onOpenChange={(open) => {
          if (!open) {
            onClose();
          }
        }}
      />

      <VStack gap={4} style={body} hAlign="stretch">
        {conflict !== null ? (
          <Banner
            status="warning"
            title="Someone else uploaded first"
            description={`This document is now at version ${conflict}. Close this, take a look at what they uploaded, and try again if yours is still the one the club needs.`}
          />
        ) : null}

        {error ? <Banner status="error" title={error} /> : null}

        <FileInput
          label="New file"
          isRequired
          mode="dropzone"
          value={file}
          accept={ACCEPT}
          maxSize={MAX_DOCUMENT_FILE_BYTES}
          onChange={(chosen) => {
            setFile(Array.isArray(chosen) ? (chosen[0] ?? null) : chosen);
            setFileError(null);
          }}
          status={fileError ? {type: 'error', message: fileError} : undefined}
        />

        <Text type="supporting" color="secondary">
          Up to 25 MB. The file name members see is the name of the file you
          upload here.
        </Text>
      </VStack>

      <Divider />

      <HStack gap={2} hAlign="end" style={footer}>
        <Button label="Cancel" variant="ghost" onClick={onClose} />
        <Button
          label="Upload"
          variant="primary"
          isLoading={isSaving}
          onClick={() => void submit()}
        />
      </HStack>
    </Dialog>
  );
}
