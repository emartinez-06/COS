'use client';

/**
 * The document hub: everything the club has written down, by section.
 *
 * Sections come from `groupDocumentsBySection` in @cos/core rather than from a
 * sort here, so the order a member reads them in - what the club is, then what
 * to do, then the working material - is decided once and shared with anything
 * else that ever lists documents.
 *
 * **Empty sections are shown to officers and hidden from members.** Both halves
 * are deliberate. An officer who never sees a "Rules and bylaws" heading never
 * finds out the club has no rules written down, which is exactly the gap this
 * hub exists to close. A member has nothing to do about it, and five empty
 * headings above the two real documents would bury them.
 *
 * Every member holds `document:view`, so unlike the treasury this surface is
 * not officer-only. What officers get is the create control, the drafts (the
 * server decides that, not this component), and the editor on the other side of
 * a click.
 */

import {useMemo, useState, type CSSProperties} from 'react';
import {useRouter} from 'next/navigation';
import {Badge} from '@astryxdesign/core/Badge';
import {Banner} from '@astryxdesign/core/Banner';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {ClickableCard} from '@astryxdesign/core/ClickableCard';
import {EmptyState} from '@astryxdesign/core/EmptyState';
import {Icon} from '@astryxdesign/core/Icon';
import {Skeleton} from '@astryxdesign/core/Skeleton';
import {HStack, VStack} from '@astryxdesign/core/Stack';
import {Heading, Text} from '@astryxdesign/core/Text';
import {
  ArrowUpTrayIcon,
  DocumentTextIcon,
  FolderOpenIcon,
  PaperClipIcon,
} from '@heroicons/react/24/outline';
import type {ClubDocument, DocumentSection} from '@cos/core';
import {
  ALL_DOCUMENT_SECTIONS,
  DOCUMENT_SECTION_LABELS,
  groupDocumentsBySection,
} from '@cos/core';

import {formatDateTimeShort} from '../../lib/datetime';
import {useDocuments} from '../../lib/document-store';
import {formatBytes} from '../../lib/format';
import {useCan, useSession} from '../../lib/session';
import {DocumentComposerDialog} from './document-composer-dialog';

const page: CSSProperties = {
  padding: 'var(--spacing-5)',
  minWidth: 0,
  // The hub is a reading surface, not a dashboard. Beyond about this width a
  // one-line summary stretches into something the eye has to track across.
  maxWidth: 900,
};

const cardBody: CSSProperties = {minWidth: 0};

/** Wraps rather than truncates: a document's title is how it is found. */
const titleText: CSSProperties = {
  overflowWrap: 'anywhere',
};

function DocumentCard({document}: {document: ClubDocument}) {
  const router = useRouter();
  const href = `/documents/${encodeURIComponent(document.id)}`;

  return (
    <ClickableCard
      label={document.title}
      padding={4}
      href={href}
      // `href` is passed as well as this handler so that modifier-clicking and
      // middle-clicking open a new tab, which ClickableCard already implements.
      // A plain click is intercepted here and handed to the router instead,
      // because the anchor ClickableCard renders is a real `<a>` and following
      // it would reload the whole dashboard.
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey) {
          return;
        }
        event.preventDefault();
        router.push(href);
      }}>
      <VStack gap={2} style={cardBody} hAlign="stretch">
        <HStack gap={3} vAlign="start" hAlign="between">
          <HStack gap={2} vAlign="center" style={cardBody}>
            <Icon
              icon={document.kind === 'file' ? PaperClipIcon : DocumentTextIcon}
              color="secondary"
            />
            <Text type="body" weight="semibold" display="block" style={titleText}>
              {document.title}
            </Text>
          </HStack>
          {document.status === 'draft' ? (
            <Badge label="Draft" variant="warning" />
          ) : null}
        </HStack>

        {document.summary ? (
          <Text type="supporting" color="secondary" display="block">
            {document.summary}
          </Text>
        ) : null}

        <Text type="supporting" color="secondary" display="block">
          {describe(document)}
        </Text>
      </VStack>
    </ClickableCard>
  );
}

/**
 * The one-line provenance under a document.
 *
 * Who last touched it and when, because in a club the useful question about the
 * bylaws is almost always "is this still the current version" rather than
 * anything about the document itself.
 */
function describe(document: ClubDocument): string {
  const parts = [`Updated by ${document.updatedBy}`];
  parts.push(formatDateTimeShort(document.updatedAt));
  if (document.file) {
    parts.push(`${document.file.name} · ${formatBytes(document.file.byteSize)}`);
  }
  return parts.join(' · ');
}

function Section({
  section,
  documents,
  canCreate,
}: {
  section: DocumentSection;
  documents: ClubDocument[];
  canCreate: boolean;
}) {
  return (
    <VStack gap={3} hAlign="stretch">
      <HStack gap={2} vAlign="center">
        <Heading level={3}>{DOCUMENT_SECTION_LABELS[section]}</Heading>
        <Text type="supporting" color="secondary">
          {documents.length === 0
            ? 'Nothing here yet'
            : `${documents.length} ${
                documents.length === 1 ? 'document' : 'documents'
              }`}
        </Text>
      </HStack>

      {documents.length === 0 ? (
        <Card padding={4} variant="muted">
          <Text type="supporting" color="secondary">
            {canCreate
              ? 'No documents filed here. Anything you add to this section shows up for every member.'
              : 'Nothing filed here yet.'}
          </Text>
        </Card>
      ) : (
        <VStack gap={2} hAlign="stretch">
          {documents.map((document) => (
            <DocumentCard key={document.id} document={document} />
          ))}
        </VStack>
      )}
    </VStack>
  );
}

export function DocumentsView() {
  const {documents, isLoading, error} = useDocuments();
  const canCreate = useCan('document:create');
  const {activeClub} = useSession();

  const [composer, setComposer] = useState<{
    isOpen: boolean;
    kind: 'text' | 'file';
  }>({isOpen: false, kind: 'text'});

  const bySection = useMemo(
    () => groupDocumentsBySection(documents),
    [documents],
  );

  const sections = ALL_DOCUMENT_SECTIONS.filter(
    (section) => canCreate || (bySection.get(section)?.length ?? 0) > 0,
  );

  if (isLoading) {
    return (
      <VStack gap={4} style={page} hAlign="stretch">
        <Skeleton width={260} height={32} />
        <Skeleton height={120} />
        <Skeleton height={120} />
      </VStack>
    );
  }

  // Shown instead of the hub, not above it. A failed load leaves `documents`
  // empty, and an empty hub says the club has not written anything down - which
  // would be a confident lie when the truth is that we could not reach the API.
  if (error) {
    return (
      <VStack gap={4} style={page} hAlign="stretch">
        <Banner
          status="error"
          title="Could not load this club’s documents"
          description={error}
          endContent={
            <Button
              label="Retry"
              variant="secondary"
              onClick={() => window.location.reload()}
            />
          }
        />
      </VStack>
    );
  }

  return (
    <>
      <VStack gap={6} style={page} hAlign="stretch">
        <HStack gap={4} hAlign="between" vAlign="start">
          <VStack gap={1}>
            <Heading level={2}>Documents</Heading>
            <Text type="body" color="secondary">
              {activeClub?.name ?? 'The club'}’s standing records - the rules,
              the onboarding material, the notes from every meeting.
            </Text>
          </VStack>

          {canCreate ? (
            <HStack gap={2}>
              <Button
                label="Upload a file"
                variant="secondary"
                icon={<Icon icon={ArrowUpTrayIcon} size="sm" />}
                onClick={() => setComposer({isOpen: true, kind: 'file'})}
              />
              <Button
                label="Write a document"
                variant="primary"
                onClick={() => setComposer({isOpen: true, kind: 'text'})}
              />
            </HStack>
          ) : null}
        </HStack>

        {documents.length === 0 ? (
          <Card padding={8}>
            <EmptyState
              icon={<Icon icon={FolderOpenIcon} />}
              title="Nothing has been filed yet"
              description={
                canCreate
                  ? 'Write the constitution here or upload the PDF you already have. Every member sees it as soon as you publish it.'
                  : 'Your officers have not added any documents yet. When they do, they appear here.'
              }
              actions={
                canCreate ? (
                  <Button
                    label="Write a document"
                    variant="primary"
                    size="sm"
                    onClick={() => setComposer({isOpen: true, kind: 'text'})}
                  />
                ) : undefined
              }
            />
          </Card>
        ) : (
          sections.map((section) => (
            <Section
              key={section}
              section={section}
              documents={bySection.get(section) ?? []}
              canCreate={canCreate}
            />
          ))
        )}
      </VStack>

      {canCreate ? (
        <DocumentComposerDialog
          isOpen={composer.isOpen}
          kind={composer.kind}
          onClose={() => setComposer((current) => ({...current, isOpen: false}))}
        />
      ) : null}
    </>
  );
}
