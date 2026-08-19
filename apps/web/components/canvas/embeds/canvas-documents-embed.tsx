'use client';

/**
 * The document hub's summary, embedded on the canvas.
 *
 * Reuses `useDocuments()` directly, and the same section-tokens-plus-
 * recent-list shape `DocumentsCard` draws on the dashboard - trimmed of
 * `CardShell`'s own title/link chrome, since `CanvasEmbedShell` already
 * supplies a header.
 */

import type {CSSProperties} from 'react';
import NextLink from 'next/link';
import {Divider} from '@astryxdesign/core/Divider';
import {Link} from '@astryxdesign/core/Link';
import {HStack, VStack} from '@astryxdesign/core/Stack';
import {Skeleton} from '@astryxdesign/core/Skeleton';
import {Text} from '@astryxdesign/core/Text';
import {Timestamp} from '@astryxdesign/core/Timestamp';
import {Token} from '@astryxdesign/core/Token';
import {DOCUMENT_SECTION_LABELS, groupDocumentsBySection} from '@cos/core';

import {useDocuments} from '../../../lib/document-store';
import type {EntityEmbedRendererProps} from '../entity-embed-registry';

const MAX_RECENT = 4;

const scroll: CSSProperties = {overflowY: 'auto', height: '100%'};

export function CanvasDocumentsEmbed(_props: EntityEmbedRendererProps) {
  const {documents, isLoading, error} = useDocuments();

  if (isLoading) {
    return (
      <VStack gap={3} hAlign="stretch">
        <Skeleton height={20} />
        <Skeleton height={20} />
      </VStack>
    );
  }

  if (error) {
    return (
      <Text type="body" color="secondary">
        The documents could not be loaded.
      </Text>
    );
  }

  if (documents.length === 0) {
    return (
      <Text type="body" color="secondary">
        Nothing filed yet.
      </Text>
    );
  }

  const grouped = groupDocumentsBySection(documents);
  const populated = [...grouped.entries()].filter(([, docs]) => docs.length > 0);

  const recent = [...documents]
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, MAX_RECENT);

  return (
    <VStack gap={4} hAlign="stretch" style={scroll}>
      <HStack gap={2} wrap="wrap">
        {populated.map(([section, docs]) => (
          <Token key={section} label={`${DOCUMENT_SECTION_LABELS[section]} ${docs.length}`} size="sm" />
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
              <Timestamp value={doc.updatedAt} format="relative" />
            </Text>
          </VStack>
        ))}
      </VStack>
    </VStack>
  );
}
