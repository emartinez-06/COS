/**
 * Names the route, and mounts the document store for the hub and every
 * document under it. See the calendar's layout for why the title lives in a
 * layout, and `DocumentsProvider` for why the store is hoisted to this level
 * rather than sitting on each page.
 */

import type {Metadata} from 'next';

import {DocumentsProvider} from '../../../components/documents/documents-provider';

export const metadata: Metadata = {
  title: 'Documents',
};

export default function DocumentsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <DocumentsProvider>{children}</DocumentsProvider>;
}
