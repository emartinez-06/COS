'use client';

/**
 * What the club has written down.
 *
 * The hub itself groups every document under every section heading. That is
 * right for a page you go to in order to find something, and wrong for a
 * summary: a reader glancing at the dashboard wants to know the records exist
 * and what changed, not to re-read the filing system.
 *
 * So this shows the sections that actually hold something, with counts, and
 * the handful of documents touched most recently. Empty sections are dropped
 * here even for officers - the hub is where an officer is told a section is
 * bare, because that is where they can do something about it.
 */

import NextLink from 'next/link';
import {Divider} from '@astryxdesign/core/Divider';
import {Link} from '@astryxdesign/core/Link';
import {HStack, VStack} from '@astryxdesign/core/Stack';
import {Text} from '@astryxdesign/core/Text';
import {Token} from '@astryxdesign/core/Token';
import {Skeleton} from '@astryxdesign/core/Skeleton';
import {Timestamp} from '@astryxdesign/core/Timestamp';
import {DOCUMENT_SECTION_LABELS, groupDocumentsBySection} from '@cos/core';

import {useDocuments} from '../../lib/document-store';
import {CardShell} from './card-shell';

const MAX_RECENT = 3;

export function DocumentsCard() {
  const {documents, isLoading, error} = useDocuments();

  const grouped = groupDocumentsBySection(documents);
  const populated = [...grouped.entries()].filter(
    ([, docs]) => docs.length > 0,
  );

  const recent = [...documents]
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, MAX_RECENT);

  return (
    <CardShell
      title="Documents"
      href="/documents"
      actionLabel="Open the documents hub"
      meta={
        isLoading || error
          ? undefined
          : `${documents.length} ${documents.length === 1 ? 'document' : 'documents'}`
      }>
      {isLoading ? (
        <VStack gap={3} hAlign="stretch">
          <Skeleton height={20} />
          <Skeleton height={20} />
        </VStack>
      ) : error ? (
        <Text type="body" color="secondary">
          The documents could not be loaded.
        </Text>
      ) : documents.length === 0 ? (
        <Text type="body" color="secondary">
          Nothing filed yet.
        </Text>
      ) : (
        <VStack gap={4} hAlign="stretch">
          <HStack gap={2} wrap="wrap">
            {populated.map(([section, docs]) => (
              <Token
                key={section}
                label={`${DOCUMENT_SECTION_LABELS[section]} ${docs.length}`}
                size="sm"
              />
            ))}
          </HStack>

          <Divider />

          <VStack gap={3} hAlign="stretch">
            <Text type="supporting" color="secondary" display="block">
              Recently updated
            </Text>
            {recent.map((doc) => (
              <VStack key={doc.id} gap={0} hAlign="stretch">
                <Link as={NextLink} href={`/documents/${doc.id}`}>
                  {doc.title}
                </Link>
                <Text type="supporting" color="secondary" display="block">
                  {/*
                    Relative, because on this surface the useful fact is "this
                    moved recently", not the exact minute. Timestamp keeps the
                    full absolute date as the accessible name and in its hover
                    card, so precision is one hover away rather than gone.
                  */}
                  <Timestamp value={doc.updatedAt} format="relative" />
                </Text>
              </VStack>
            ))}
          </VStack>
        </VStack>
      )}
    </CardShell>
  );
}
