'use client';

/**
 * One document: read it, and if you are an officer, change it.
 *
 * Members and officers render the same tree, with every difference a capability
 * check - the same rule the calendar follows, and the reason "one dashboard,
 * two views" is a real claim rather than two implementations that drift.
 *
 * The two kinds diverge here and nowhere else. A `text` document renders as a
 * live, always-on collaborative editor (`DocumentCollabEditor`) - readable by
 * anyone with `document:view`, writable by anyone with `document:edit`,
 * updating as anyone connected types; a `file` document renders what is known
 * about the file and a way to get it. Everything around them - the title, the
 * section, the history, the officer controls - is identical, which is the
 * payoff for making them one model instead of two.
 */

import {useState, type CSSProperties} from 'react';
import NextLink from 'next/link';
import {useRouter} from 'next/navigation';
import {AlertDialog} from '@astryxdesign/core/AlertDialog';
import {Badge} from '@astryxdesign/core/Badge';
import {Banner} from '@astryxdesign/core/Banner';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {EmptyState} from '@astryxdesign/core/EmptyState';
import {Icon} from '@astryxdesign/core/Icon';
import {Link} from '@astryxdesign/core/Link';
import {Skeleton} from '@astryxdesign/core/Skeleton';
import {HStack, VStack} from '@astryxdesign/core/Stack';
import {Heading, Text} from '@astryxdesign/core/Text';
import {
  ArrowDownTrayIcon,
  ArrowUpTrayIcon,
  DocumentMagnifyingGlassIcon,
  PaperClipIcon,
} from '@heroicons/react/24/outline';
import type {ClubDocumentDetail} from '@cos/core';
import {DOCUMENT_SECTION_LABELS, onlyOfficeFileInfo} from '@cos/core';

import {formatDateTimeShort} from '../../lib/datetime';
import {useDocument, useDocuments} from '../../lib/document-store';
import {saveBlob} from '../../lib/download';
import {formatBytes} from '../../lib/format';
import {useCan} from '../../lib/session';
import {DocumentCollabEditor} from './document-collab-editor';
import {DocumentEditor} from './document-editor';
import {DocumentHistory} from './document-history';
import {DocumentOnlyOfficeEditor} from './document-onlyoffice-editor';
import {DocumentReplaceFileDialog} from './document-replace-file-dialog';

const page: CSSProperties = {
  padding: 'var(--spacing-5)',
  minWidth: 0,
  maxWidth: 900,
};

const grow: CSSProperties = {minWidth: 0};

/** A title is the one thing on this page that must never be clipped. */
const titleText: CSSProperties = {overflowWrap: 'anywhere'};

export function DocumentDetailView({documentId}: {documentId: string}) {
  const {updateDocument, deleteDocument, repository, clubId} = useDocuments();
  const {document, isLoading, isMissing, error, set} = useDocument(documentId);
  const canEdit = useCan('document:edit');
  const canDelete = useCan('document:delete');
  const router = useRouter();

  const [isEditing, setIsEditing] = useState(false);
  const [isReplacing, setIsReplacing] = useState(false);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function download(version?: number) {
    setActionError(null);
    try {
      const bytes = await repository.download(clubId, documentId, version);
      saveBlob(
        bytes as Blob,
        document?.file?.name ?? `${document?.title ?? 'document'}`,
      );
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function remove() {
    setIsDeleting(true);
    try {
      await deleteDocument(documentId);
      router.push('/documents');
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
      setIsDeleting(false);
      setIsConfirmingDelete(false);
    }
  }

  if (isLoading) {
    return (
      <VStack gap={4} style={page} hAlign="stretch">
        <Skeleton width={220} height={20} />
        <Skeleton width={420} height={36} />
        <Skeleton height={360} />
      </VStack>
    );
  }

  if (isMissing || (!document && !error)) {
    return (
      <VStack gap={4} style={page} hAlign="stretch">
        <BackLink />
        <Card padding={8}>
          <EmptyState
            icon={<Icon icon={DocumentMagnifyingGlassIcon} />}
            title="That document is not here"
            description="It may have been removed, or it may be a draft that only officers can see."
            actions={
              <Button
                label="Back to documents"
                variant="secondary"
                size="sm"
                as={NextLink}
                href="/documents"
              />
            }
          />
        </Card>
      </VStack>
    );
  }

  if (!document) {
    return (
      <VStack gap={4} style={page} hAlign="stretch">
        <BackLink />
        <Banner
          status="error"
          title="Could not load this document"
          description={error ?? undefined}
        />
      </VStack>
    );
  }

  return (
    <>
      <VStack gap={5} style={page} hAlign="stretch">
        <BackLink />

        <HStack gap={4} hAlign="between" vAlign="start">
          <VStack gap={2} style={grow}>
            <HStack gap={2} vAlign="center">
              <Badge
                label={DOCUMENT_SECTION_LABELS[document.section]}
                variant="neutral"
              />
              {document.status === 'draft' ? (
                <Badge label="Draft" variant="warning" />
              ) : null}
              <Text type="supporting" color="secondary">
                Version {document.version}
              </Text>
            </HStack>

            <Heading level={2} style={titleText}>
              {document.title}
            </Heading>

            {document.summary ? (
              <Text type="body" color="secondary" display="block">
                {document.summary}
              </Text>
            ) : null}

            <Text type="supporting" color="secondary" display="block">
              Added by {document.createdBy} · Last updated by{' '}
              {document.updatedBy} on {formatDateTimeShort(document.updatedAt)}
            </Text>
          </VStack>

          {canEdit && !isEditing ? (
            <HStack gap={2}>
              {document.kind === 'file' ? (
                <Button
                  label="New version"
                  variant="secondary"
                  icon={<Icon icon={ArrowUpTrayIcon} size="sm" />}
                  onClick={() => setIsReplacing(true)}
                />
              ) : null}
              <Button
                label="Edit"
                variant="primary"
                onClick={() => setIsEditing(true)}
              />
            </HStack>
          ) : null}
        </HStack>

        {document.status === 'draft' && canEdit ? (
          <Banner
            status="info"
            title="This is a draft"
            description="Only officers can see it. Publish it from the editor when it is ready for the club."
          />
        ) : null}

        {actionError ? <Banner status="error" title={actionError} /> : null}

        {isEditing ? (
          <DocumentEditor
            document={document}
            onSave={async (patch) => {
              const saved = await updateDocument(documentId, patch);
              set(saved);
              return saved;
            }}
            onDone={() => setIsEditing(false)}
          />
        ) : null}

        {document.kind === 'file' ? (
          document.file && onlyOfficeFileInfo(document.file.contentType) ? (
            // Always mounted, whether or not the metadata form above is
            // open - same reasoning as the text-kind branch below: content
            // editing is independent of "Edit", which only ever touches
            // metadata now.
            <DocumentOnlyOfficeEditor clubId={clubId} documentId={documentId} />
          ) : !isEditing ? (
            <FileBody document={document} onDownload={() => void download()} />
          ) : null
        ) : (
          // Always mounted, whether or not the metadata form above is open -
          // content editing is live and no longer gated by "Edit". See
          // DocumentCollabEditor's module doc.
          <Card padding={0}>
            <DocumentCollabEditor
              clubId={clubId}
              documentId={documentId}
              canEdit={canEdit}
            />
          </Card>
        )}

        <DocumentHistory
          document={document}
          onDownload={(version) => void download(version)}
        />

        {canDelete && !isEditing ? (
          <HStack hAlign="start">
            <Button
              label="Remove from the hub"
              variant="ghost"
              onClick={() => setIsConfirmingDelete(true)}
            />
          </HStack>
        ) : null}
      </VStack>

      {document.kind === 'file' && canEdit ? (
        <DocumentReplaceFileDialog
          isOpen={isReplacing}
          document={document}
          onClose={() => setIsReplacing(false)}
          onReplaced={set}
        />
      ) : null}

      <AlertDialog
        isOpen={isConfirmingDelete}
        onOpenChange={setIsConfirmingDelete}
        title={`Remove “${document.title}”?`}
        description="It stops appearing in the hub for everyone. Its history is kept, so this can be undone by someone with database access - but not from here."
        actionLabel="Remove"
        isActionLoading={isDeleting}
        onAction={() => void remove()}
      />
    </>
  );
}

function BackLink() {
  return (
    <Link as={NextLink} href="/documents">
      All documents
    </Link>
  );
}

/**
 * An uploaded file: what it is, how big, and a way to get it.
 *
 * No inline preview. The API serves these with `Content-Disposition:
 * attachment` on purpose - an uploaded document is the club's file, not a page
 * this app renders - and an iframe here would be arguing with that decision
 * from the other side of the wire.
 */
function FileBody({
  document,
  onDownload,
}: {
  document: ClubDocumentDetail;
  onDownload: () => void;
}) {
  return (
    <Card padding={6}>
      <HStack gap={4} vAlign="center" hAlign="between">
        <HStack gap={3} vAlign="center" style={grow}>
          <Icon icon={PaperClipIcon} color="secondary" />
          <VStack gap={0} style={grow}>
            <Text type="body" weight="semibold" display="block">
              {document.file?.name ?? 'Attached file'}
            </Text>
            <Text type="supporting" color="secondary" display="block">
              {document.file
                ? `${formatBytes(document.file.byteSize)} · ${
                    document.file.contentType
                  }`
                : 'No file recorded'}
            </Text>
          </VStack>
        </HStack>

        <Button
          label="Download"
          variant="primary"
          icon={<Icon icon={ArrowDownTrayIcon} size="sm" />}
          onClick={onDownload}
        />
      </HStack>
    </Card>
  );
}
