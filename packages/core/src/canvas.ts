/**
 * The club canvas.
 *
 * A shared, officer-only whiteboard: one infinite board per club, holding
 * sticky notes, links, images, and "embed" nodes that show a live summary of
 * another part of the product (this club's calendar, documents, or
 * treasury) without leaving the board. Officers use it to plan out loud -
 * connecting related things with a line is the whole point, the way people
 * already draw arrows between sticky notes on a real whiteboard.
 *
 * There is no `kanban` node type. COS has no pipeline/board-of-columns
 * concept anywhere else in the product, and inventing one here to match a
 * feature this was adapted from would be new scope, not a port.
 *
 * ## Node content is typed columns, not a JSON blob
 *
 * Each node kind's content lives in its own nullable fields on `CanvasNode`
 * rather than one untyped `data` column, because there are only four kinds
 * and COS's schema has no jsonb precedent anywhere else. `CanvasNodeDraft`'s
 * discriminated union is what actually enforces "a sticky note has text, a
 * link has a URL" - the persisted shape mirrors it so a row and a draft never
 * disagree about which fields a given `nodeType` owns.
 */

import {z} from 'zod';

import {isoInstantSchema} from './club-event.js';

/** What a node on the board is. */
export const canvasNodeTypeSchema = z.enum([
  'sticky_note',
  'link',
  'image',
  'entity_embed',
]);

export type CanvasNodeType = z.infer<typeof canvasNodeTypeSchema>;

/**
 * Which of the club's own surfaces an `entity_embed` node mirrors.
 *
 * Fixed at creation and never re-patched - changing what an embed shows is a
 * delete-and-re-add, the same as the feature it was dropped from. Every
 * value here corresponds to a real destination in `nav-config.tsx`; there is
 * no entry for a category the product does not actually have yet.
 */
export const canvasEmbedEntityTypeSchema = z.enum([
  'calendar',
  'documents',
  'expenses',
]);

export type CanvasEmbedEntityType = z.infer<typeof canvasEmbedEntityTypeSchema>;

export const CANVAS_EMBED_ENTITY_LABELS: Record<CanvasEmbedEntityType, string> = {
  calendar: 'Calendar',
  documents: 'Documents',
  expenses: 'Expenses',
};

/** Fixed pastel fills a sticky note may take. Free colour picking turns into forty near-duplicate yellows. */
export const stickyNoteColorSchema = z.enum([
  'yellow',
  'pink',
  'blue',
  'green',
  'purple',
]);

export type StickyNoteColor = z.infer<typeof stickyNoteColorSchema>;

export const STICKY_NOTE_COLOR_HEX: Record<StickyNoteColor, string> = {
  yellow: '#FDE68A',
  pink: '#FBCFE8',
  blue: '#BFDBFE',
  green: '#BBF7D0',
  purple: '#DDD6FE',
};

export const STICKY_NOTE_COLOR_LABELS: Record<StickyNoteColor, string> = {
  yellow: 'Amber',
  pink: 'Pink',
  blue: 'Blue',
  green: 'Green',
  purple: 'Purple',
};

/** Every sticky note colour, in swatch order. */
export const ALL_STICKY_NOTE_COLORS: readonly StickyNoteColor[] =
  stickyNoteColorSchema.options;

/**
 * Fixed saturated colours a node's accent border may take. `null` is the
 * default border - not a colour in this set, so it can never collide with a
 * deliberate choice.
 *
 * Connecting two nodes paints whichever end has no accent with the other's
 * (see `resolveAccentPropagation` in the web layer), which is what turns a
 * scattered board into readable clusters. Distinct from the navy product
 * accent and the amber "today" marker so an accented node never reads as a
 * primary action or an orientation cue.
 */
export const canvasAccentColorSchema = z.enum([
  'red',
  'orange',
  'green',
  'teal',
  'purple',
  'pink',
]);

export type CanvasAccentColor = z.infer<typeof canvasAccentColorSchema>;

export const CANVAS_ACCENT_COLOR_HEX: Record<CanvasAccentColor, string> = {
  red: '#DC2626',
  orange: '#EA580C',
  green: '#16A34A',
  teal: '#0D9488',
  purple: '#7C3AED',
  pink: '#DB2777',
};

export const CANVAS_ACCENT_COLOR_LABELS: Record<CanvasAccentColor, string> = {
  red: 'Red',
  orange: 'Orange',
  green: 'Green',
  teal: 'Teal',
  purple: 'Purple',
  pink: 'Pink',
};

/** Every accent colour, in swatch order. */
export const ALL_CANVAS_ACCENT_COLORS: readonly CanvasAccentColor[] =
  canvasAccentColorSchema.options;

export const MAX_STICKY_NOTE_TEXT_CHARS = 2000;
export const MAX_LINK_TITLE_CHARS = 200;

/**
 * The largest image an `image` node accepts, in bytes.
 *
 * Smaller than the document hub's 25 MB ceiling: an image node renders
 * inline on a board someone is actively panning and zooming, not downloaded
 * once and opened elsewhere, so a very large file costs everyone viewing the
 * canvas rather than just its uploader.
 */
export const MAX_CANVAS_IMAGE_BYTES = 10 * 1024 * 1024;

/**
 * Content types an `image` node accepts.
 *
 * Narrower than `ALLOWED_DOCUMENT_CONTENT_TYPES` on purpose: this node
 * renders its upload as an `<img>`, so anything that is not actually an
 * image is refused rather than stored and served back as one.
 */
export const ALLOWED_CANVAS_IMAGE_CONTENT_TYPES: readonly string[] = [
  'image/png',
  'image/jpeg',
];

/** Why an image upload was refused. */
export type CanvasImageUploadRejection = 'too-large' | 'unsupported-type' | 'empty';

/**
 * Checks an image against the canvas's limits. Pure and shared, the same
 * reasoning as `checkDocumentUpload`: the browser calls it before spending a
 * minute uploading something that will be refused, and the API calls it
 * because a client-side check protects nothing.
 */
export function checkCanvasImageUpload(file: {
  contentType: string;
  byteSize: number;
}): {ok: true} | {ok: false; reason: CanvasImageUploadRejection} {
  if (file.byteSize <= 0) {
    return {ok: false, reason: 'empty'};
  }
  if (file.byteSize > MAX_CANVAS_IMAGE_BYTES) {
    return {ok: false, reason: 'too-large'};
  }
  const mediaType = file.contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  if (!ALLOWED_CANVAS_IMAGE_CONTENT_TYPES.includes(mediaType)) {
    return {ok: false, reason: 'unsupported-type'};
  }
  return {ok: true};
}

export const CANVAS_IMAGE_UPLOAD_REJECTION_MESSAGES: Record<
  CanvasImageUploadRejection,
  string
> = {
  'too-large': `That image is larger than the ${Math.floor(
    MAX_CANVAS_IMAGE_BYTES / (1024 * 1024),
  )} MB limit`,
  'unsupported-type': 'Only PNG and JPEG images are accepted',
  empty: 'That image is empty',
};

/** Geometry every node kind carries, in flow-space pixels. */
const canvasNodeGeometryBase = {
  positionX: z.number().int(),
  positionY: z.number().int(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
};

export const stickyNoteNodeDraftSchema = z.object({
  nodeType: z.literal('sticky_note'),
  ...canvasNodeGeometryBase,
  text: z.string().trim().max(MAX_STICKY_NOTE_TEXT_CHARS).default(''),
  color: stickyNoteColorSchema.default('yellow'),
});

export const linkNodeDraftSchema = z.object({
  nodeType: z.literal('link'),
  ...canvasNodeGeometryBase,
  url: z.url('Must be a valid URL'),
  title: z.string().trim().max(MAX_LINK_TITLE_CHARS).default(''),
});

/**
 * A new image node. Carries no bytes - the file arrives as a separate part
 * of a multipart request, the same reasoning as `fileDocumentDraftSchema`.
 */
export const imageNodeDraftSchema = z.object({
  nodeType: z.literal('image'),
  ...canvasNodeGeometryBase,
});

export const entityEmbedNodeDraftSchema = z.object({
  nodeType: z.literal('entity_embed'),
  ...canvasNodeGeometryBase,
  entityType: canvasEmbedEntityTypeSchema,
});

/** A new node, discriminated by `nodeType`. */
export const canvasNodeDraftSchema = z.discriminatedUnion('nodeType', [
  stickyNoteNodeDraftSchema,
  linkNodeDraftSchema,
  imageNodeDraftSchema,
  entityEmbedNodeDraftSchema,
]);

export type CanvasNodeDraft = z.infer<typeof canvasNodeDraftSchema>;

/**
 * A persisted node.
 *
 * The type-specific fields are siblings, all nullable, rather than a nested
 * per-kind object - only the ones matching `nodeType` are ever non-null, and
 * the API never returns a row where that is not true. See the module doc for
 * why this is typed columns rather than one `data` blob.
 */
export const canvasNodeSchema = z.object({
  id: z.string().min(1),
  boardId: z.string().min(1),
  nodeType: canvasNodeTypeSchema,
  positionX: z.number().int(),
  positionY: z.number().int(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** Stacking order among sibling nodes on the same board. */
  zIndex: z.number().int(),
  accentColor: canvasAccentColorSchema.nullable(),
  stickyNoteText: z.string().max(MAX_STICKY_NOTE_TEXT_CHARS).nullable(),
  stickyNoteColor: stickyNoteColorSchema.nullable(),
  linkUrl: z.url().nullable(),
  linkTitle: z.string().max(MAX_LINK_TITLE_CHARS).nullable(),
  /** Resolves through object storage. Present on `image` nodes only. */
  imageStorageKey: z.string().min(1).nullable(),
  embedEntityType: canvasEmbedEntityTypeSchema.nullable(),
  createdAt: isoInstantSchema,
  updatedAt: isoInstantSchema,
});

export type CanvasNode = z.infer<typeof canvasNodeSchema>;

/**
 * An edit to a node's position, size, stacking order, or accent - the fields
 * every node kind shares, fired by dragging, resizing, or recolouring.
 * Content is a separate patch (`canvasNodeContentPatchSchema`) below, since
 * not every node kind has editable content at all.
 */
export const canvasNodeGeometryPatchSchema = z.object({
  positionX: z.number().int().optional(),
  positionY: z.number().int().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  zIndex: z.number().int().optional(),
  accentColor: canvasAccentColorSchema.nullable().optional(),
});

export type CanvasNodeGeometryPatch = z.infer<
  typeof canvasNodeGeometryPatchSchema
>;

/**
 * An edit to a node's own content. Only `sticky_note` and `link` nodes have
 * any - an `image` node's bytes are fixed at upload, and an `entity_embed`'s
 * `entityType` is fixed at creation (see `canvasEmbedEntityTypeSchema`), so
 * there is nothing for either to patch here.
 */
export const canvasNodeContentPatchSchema = z.discriminatedUnion('nodeType', [
  z.object({
    nodeType: z.literal('sticky_note'),
    text: z.string().trim().max(MAX_STICKY_NOTE_TEXT_CHARS).optional(),
    color: stickyNoteColorSchema.optional(),
  }),
  z.object({
    nodeType: z.literal('link'),
    url: z.url('Must be a valid URL').optional(),
    title: z.string().trim().max(MAX_LINK_TITLE_CHARS).optional(),
  }),
]);

export type CanvasNodeContentPatch = z.infer<
  typeof canvasNodeContentPatchSchema
>;

/**
 * A connection between two nodes. No direction semantics beyond which end
 * was dragged from, no label - the simplest thing that lets an officer
 * visually connect two related things on the board.
 */
export const canvasEdgeCreateSchema = z.object({
  sourceNodeId: z.string().min(1),
  targetNodeId: z.string().min(1),
});

export type CanvasEdgeDraft = z.infer<typeof canvasEdgeCreateSchema>;

export const canvasEdgeSchema = z.object({
  id: z.string().min(1),
  boardId: z.string().min(1),
  sourceNodeId: z.string().min(1),
  targetNodeId: z.string().min(1),
  createdAt: isoInstantSchema,
});

export type CanvasEdge = z.infer<typeof canvasEdgeSchema>;

/** The one board a club has. Created lazily on first visit. */
export const canvasBoardSchema = z.object({
  id: z.string().min(1),
  clubId: z.string().min(1),
  /** Last-known pan position (flow-space x), so the board reopens where it was left. */
  viewportX: z.number().int(),
  viewportY: z.number().int(),
  /** Last-known zoom, as an integer percent (100 = 100%) - avoids a float column. */
  viewportZoom: z.number().int().positive(),
  createdAt: isoInstantSchema,
  updatedAt: isoInstantSchema,
});

export type CanvasBoard = z.infer<typeof canvasBoardSchema>;

export const canvasViewportPatchSchema = z.object({
  viewportX: z.number().int(),
  viewportY: z.number().int(),
  viewportZoom: z.number().int().positive(),
});

export type CanvasViewportPatch = z.infer<typeof canvasViewportPatchSchema>;
