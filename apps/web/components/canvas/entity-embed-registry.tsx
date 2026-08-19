import type {ComponentType} from 'react';
import type {CanvasEmbedEntityType} from '@cos/core';

import {CanvasCalendarEmbed} from './embeds/canvas-calendar-embed';
import {CanvasDocumentsEmbed} from './embeds/canvas-documents-embed';
import {CanvasExpensesEmbed} from './embeds/canvas-expenses-embed';

export interface EntityEmbedRendererProps {
  /** The canvas node's own id. */
  nodeId: string;
}

/**
 * `entityType -> renderer`. Every value of `CanvasEmbedEntityType` has an
 * entry here - `canvas-node-utils.test.ts`-style coverage asserts the two
 * stay in step, the same guarantee the source design kept between its
 * palette allowlist and this registry.
 */
export const ENTITY_EMBED_RENDERERS: Record<
  CanvasEmbedEntityType,
  ComponentType<EntityEmbedRendererProps>
> = {
  calendar: CanvasCalendarEmbed,
  documents: CanvasDocumentsEmbed,
  expenses: CanvasExpensesEmbed,
};
