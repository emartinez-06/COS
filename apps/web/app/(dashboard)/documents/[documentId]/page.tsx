'use client';

/**
 * One document.
 *
 * A route of its own rather than a panel on the hub. A document is read, not
 * glanced at - the calendar's 340px context panel is the right size for an
 * event's time and location and the wrong size for a constitution - and a
 * document that has its own URL is a document an officer can paste into the
 * group chat.
 */

import {use} from 'react';

import {DocumentDetailView} from '../../../../components/documents/document-detail-view';

export default function DocumentPage({
  params,
}: {
  params: Promise<{documentId: string}>;
}) {
  const {documentId} = use(params);
  return <DocumentDetailView documentId={documentId} />;
}
