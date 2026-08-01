'use client';

/**
 * A document's history.
 *
 * This is the part of the hub that is not a file-sharing feature. docs/ARCHITECTURE.md
 * commits to an auditable ledger as the product's differentiator, and the
 * revisions table has been append-only since the day it was written; without
 * something on screen reading from it, that is a claim rather than a feature.
 * A club whose bylaws changed last spring can see who changed them and read
 * what they said before.
 *
 * Loaded on demand rather than with the document. History is the answer to a
 * question people ask occasionally, and fetching it with every read would make
 * every reader pay for it.
 *
 * Bodies are never in this list - the port returns metadata, for the same
 * reason the hub listing does. One past revision's text is fetched only when
 * someone opens it.
 */

import {useCallback, useEffect, useState, type CSSProperties} from 'react';
import {Badge} from '@astryxdesign/core/Badge';
import {Banner} from '@astryxdesign/core/Banner';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {Dialog, DialogHeader} from '@astryxdesign/core/Dialog';
import {Divider} from '@astryxdesign/core/Divider';
import {Markdown} from '@astryxdesign/core/Markdown';
import {Skeleton} from '@astryxdesign/core/Skeleton';
import {HStack, VStack} from '@astryxdesign/core/Stack';
import {Heading, Text} from '@astryxdesign/core/Text';
import type {
  ClubDocumentDetail,
  DocumentRevision,
  DocumentRevisionDetail,
} from '@cos/core';

import {formatDateTimeShort} from '../../lib/datetime';
import {useDocuments} from '../../lib/document-store';
import {formatBytes} from '../../lib/format';

const rowPadding: CSSProperties = {paddingBlock: 'var(--spacing-3)'};

const dialogBody: CSSProperties = {
  paddingInline: 'var(--spacing-5)',
  paddingBlock: 'var(--spacing-4)',
  overflowY: 'auto',
};

const grow: CSSProperties = {minWidth: 0};

/** One row, extracted so the divider after it can share the row's key. */
function RevisionRow({
  revision,
  isCurrent,
  isText,
  isOpening,
  onView,
  onDownload,
}: {
  revision: DocumentRevision;
  isCurrent: boolean;
  isText: boolean;
  isOpening: boolean;
  onView: () => void;
  onDownload: () => void;
}) {
  return (
    <>
      <HStack gap={3} hAlign="between" vAlign="center" style={rowPadding}>
        <VStack gap={0} style={grow}>
          <HStack gap={2} vAlign="center">
            <Text type="body" weight="semibold" display="block">
              Version {revision.version}
            </Text>
            {isCurrent ? <Badge label="Current" variant="success" /> : null}
          </HStack>
          <Text type="supporting" color="secondary" display="block">
            {revision.authoredBy} · {formatDateTimeShort(revision.createdAt)} ·{' '}
            {describeSize(revision)}
          </Text>
        </VStack>

        {isText ? (
          <Button
            label="View"
            variant="ghost"
            size="sm"
            isLoading={isOpening}
            onClick={onView}
          />
        ) : (
          <Button
            label="Download"
            variant="ghost"
            size="sm"
            onClick={onDownload}
          />
        )}
      </HStack>
      <Divider />
    </>
  );
}

interface DocumentHistoryProps {
  document: ClubDocumentDetail;
  /** Downloads a past revision's bytes. File documents only. */
  onDownload: (version: number) => void;
}

export function DocumentHistory({document, onDownload}: DocumentHistoryProps) {
  const {repository, clubId} = useDocuments();

  const [revisions, setRevisions] = useState<DocumentRevision[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<DocumentRevisionDetail | null>(null);
  const [isOpening, setIsOpening] = useState<number | null>(null);

  // Re-reads whenever the document's version moves, so a save adds its own
  // revision to the list without the reader refreshing the page.
  const version = document.version;

  const load = useCallback(async () => {
    try {
      setRevisions(await repository.revisions(clubId, document.id));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [repository, clubId, document.id]);

  useEffect(() => {
    void load();
  }, [load, version]);

  async function open(revision: DocumentRevision) {
    setIsOpening(revision.version);
    try {
      setViewing(
        await repository.revision(clubId, document.id, revision.version),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsOpening(null);
    }
  }

  return (
    <>
      <Card padding={6}>
        <VStack gap={2} hAlign="stretch">
          <VStack gap={1}>
            <Heading level={3}>History</Heading>
            <Text type="supporting" color="secondary">
              Every version is kept. Nothing here is ever rewritten or removed.
            </Text>
          </VStack>

          {error ? <Banner status="error" title={error} /> : null}

          {revisions === null ? (
            <Skeleton height={72} />
          ) : revisions.length === 0 ? (
            <Text type="supporting" color="secondary">
              No revisions recorded.
            </Text>
          ) : (
            <VStack gap={0} hAlign="stretch">
              {revisions.map((revision) => (
                <RevisionRow
                  key={revision.id}
                  revision={revision}
                  isCurrent={revision.version === document.version}
                  isText={document.kind === 'text'}
                  isOpening={isOpening === revision.version}
                  onView={() => void open(revision)}
                  onDownload={() => onDownload(revision.version)}
                />
              ))}
            </VStack>
          )}
        </VStack>
      </Card>

      <Dialog
        isOpen={viewing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setViewing(null);
          }
        }}
        width={720}
        maxHeight="88vh">
        <DialogHeader
          title={`Version ${viewing?.version ?? ''}`}
          subtitle={
            viewing
              ? `Written by ${viewing.authoredBy} on ${formatDateTimeShort(
                  viewing.createdAt,
                )}. Read-only.`
              : undefined
          }
          onOpenChange={(open) => {
            if (!open) {
              setViewing(null);
            }
          }}
        />
        <VStack gap={0} style={dialogBody} hAlign="stretch">
          {viewing ? (
            <Markdown headingLevelStart={3}>{viewing.content}</Markdown>
          ) : null}
        </VStack>
      </Dialog>
    </>
  );
}

/**
 * What changed, in the one number the list can show without fetching a body.
 *
 * A character count is a weak signal on its own and a strong one in a column:
 * an edit that took the bylaws from 8,000 characters to 400 is visible at a
 * glance, which is the kind of thing an audit trail is for.
 */
function describeSize(revision: DocumentRevision): string {
  if (revision.file) {
    return `${revision.file.name} · ${formatBytes(revision.file.byteSize)}`;
  }
  if (revision.charCount === null) {
    return 'no content recorded';
  }
  return `${revision.charCount.toLocaleString('en-US')} characters`;
}
