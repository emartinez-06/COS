/**
 * Tests for the club canvas's domain model.
 *
 * The interesting ones are not the schema round-trips - they are the
 * invariants that would be expensive to discover later: that a draft's
 * `nodeType` really does gate which fields are required, that every
 * accent/sticky-note colour is labelled, and that the image upload check
 * matches the document hub's own shape for the same reasons.
 */

import {describe, expect, it} from 'vitest';

import {
  ALLOWED_CANVAS_IMAGE_CONTENT_TYPES,
  ALL_CANVAS_ACCENT_COLORS,
  ALL_STICKY_NOTE_COLORS,
  CANVAS_ACCENT_COLOR_HEX,
  CANVAS_ACCENT_COLOR_LABELS,
  CANVAS_EMBED_ENTITY_LABELS,
  MAX_CANVAS_IMAGE_BYTES,
  STICKY_NOTE_COLOR_HEX,
  STICKY_NOTE_COLOR_LABELS,
  canvasEdgeCreateSchema,
  canvasEmbedEntityTypeSchema,
  canvasNodeContentPatchSchema,
  canvasNodeDraftSchema,
  canvasNodeGeometryPatchSchema,
  canvasViewportPatchSchema,
  checkCanvasImageUpload,
} from './canvas.js';

describe('a node draft, discriminated by nodeType', () => {
  it('accepts a sticky note with text and a fixed colour', () => {
    const parsed = canvasNodeDraftSchema.parse({
      nodeType: 'sticky_note',
      positionX: 0,
      positionY: 0,
      width: 240,
      height: 200,
      text: 'Bring cups',
      color: 'yellow',
    });
    expect(parsed.nodeType).toBe('sticky_note');
  });

  it('accepts a link and defaults its title to empty', () => {
    const parsed = canvasNodeDraftSchema.parse({
      nodeType: 'link',
      positionX: 0,
      positionY: 0,
      width: 280,
      height: 130,
      url: 'https://example.com',
    });
    if (parsed.nodeType !== 'link') throw new Error('expected a link');
    expect(parsed.title).toBe('');
  });

  it('refuses a link with an invalid url', () => {
    const result = canvasNodeDraftSchema.safeParse({
      nodeType: 'link',
      positionX: 0,
      positionY: 0,
      width: 280,
      height: 130,
      url: 'not a url',
    });
    expect(result.success).toBe(false);
  });

  it('accepts an image draft with geometry only - the bytes travel separately', () => {
    const parsed = canvasNodeDraftSchema.parse({
      nodeType: 'image',
      positionX: 0,
      positionY: 0,
      width: 320,
      height: 260,
    });
    expect(parsed.nodeType).toBe('image');
  });

  it('accepts an entity_embed naming one of the club’s real destinations', () => {
    const parsed = canvasNodeDraftSchema.parse({
      nodeType: 'entity_embed',
      positionX: 0,
      positionY: 0,
      width: 420,
      height: 400,
      entityType: 'calendar',
    });
    if (parsed.nodeType !== 'entity_embed') throw new Error('expected an entity_embed');
    expect(parsed.entityType).toBe('calendar');
  });

  it('refuses an entity_embed naming a destination the product does not have', () => {
    const result = canvasNodeDraftSchema.safeParse({
      nodeType: 'entity_embed',
      positionX: 0,
      positionY: 0,
      width: 420,
      height: 400,
      entityType: 'opportunities',
    });
    expect(result.success).toBe(false);
  });

  it('refuses an unknown nodeType entirely - there is no kanban here', () => {
    const result = canvasNodeDraftSchema.safeParse({
      nodeType: 'kanban',
      positionX: 0,
      positionY: 0,
      width: 100,
      height: 100,
    });
    expect(result.success).toBe(false);
  });
});

describe('geometry patch', () => {
  it('is entirely optional, so a patch changes only what it names', () => {
    const parsed = canvasNodeGeometryPatchSchema.parse({});
    expect(parsed).toEqual({});
  });

  it('accepts clearing the accent back to the default border', () => {
    const parsed = canvasNodeGeometryPatchSchema.parse({accentColor: null});
    expect(parsed.accentColor).toBeNull();
  });
});

describe('content patch, discriminated by nodeType', () => {
  it('accepts a sticky note text/colour edit', () => {
    const parsed = canvasNodeContentPatchSchema.parse({
      nodeType: 'sticky_note',
      text: 'Updated',
    });
    if (parsed.nodeType !== 'sticky_note') throw new Error('expected sticky_note');
    expect(parsed.text).toBe('Updated');
  });

  it('accepts a link url/title edit', () => {
    const parsed = canvasNodeContentPatchSchema.parse({
      nodeType: 'link',
      url: 'https://example.com/rsvp',
    });
    expect(parsed.nodeType).toBe('link');
  });

  it('has no case for image or entity_embed - neither has editable content', () => {
    const result = canvasNodeContentPatchSchema.safeParse({
      nodeType: 'image',
      url: 'https://example.com',
    });
    expect(result.success).toBe(false);
  });
});

describe('edges', () => {
  it('requires both ends', () => {
    const result = canvasEdgeCreateSchema.safeParse({sourceNodeId: 'canvas_node_1'});
    expect(result.success).toBe(false);
  });
});

describe('viewport', () => {
  it('rejects a non-positive zoom - a board cannot persist at 0% or negative', () => {
    const result = canvasViewportPatchSchema.safeParse({
      viewportX: 0,
      viewportY: 0,
      viewportZoom: 0,
    });
    expect(result.success).toBe(false);
  });
});

describe('embeddable entity types', () => {
  it('labels every entity type, and every one is a real nav-config destination', () => {
    for (const entityType of canvasEmbedEntityTypeSchema.options) {
      expect(CANVAS_EMBED_ENTITY_LABELS[entityType]).toBeTruthy();
    }
    // Exactly these three - not the CRM's ~30. Adding a fourth here without a
    // real destination in `apps/web/lib/nav-config.tsx` would be inventing a
    // feature this port does not have.
    expect(canvasEmbedEntityTypeSchema.options).toEqual([
      'calendar',
      'documents',
      'expenses',
    ]);
  });
});

describe('colour swatches', () => {
  it('labels and gives a hex value to every accent colour', () => {
    for (const color of ALL_CANVAS_ACCENT_COLORS) {
      expect(CANVAS_ACCENT_COLOR_LABELS[color]).toBeTruthy();
      expect(CANVAS_ACCENT_COLOR_HEX[color]).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });

  it('labels and gives a hex value to every sticky note colour', () => {
    for (const color of ALL_STICKY_NOTE_COLORS) {
      expect(STICKY_NOTE_COLOR_LABELS[color]).toBeTruthy();
      expect(STICKY_NOTE_COLOR_HEX[color]).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });
});

describe('checkCanvasImageUpload', () => {
  it('accepts a plausible PNG', () => {
    expect(
      checkCanvasImageUpload({contentType: 'image/png', byteSize: 1024}),
    ).toEqual({ok: true});
  });

  it('refuses an empty file', () => {
    expect(
      checkCanvasImageUpload({contentType: 'image/png', byteSize: 0}),
    ).toEqual({ok: false, reason: 'empty'});
  });

  it('refuses a file over the limit', () => {
    expect(
      checkCanvasImageUpload({
        contentType: 'image/png',
        byteSize: MAX_CANVAS_IMAGE_BYTES + 1,
      }),
    ).toEqual({ok: false, reason: 'too-large'});
  });

  it('refuses a content type outside the allowlist, even one the document hub accepts', () => {
    // application/pdf is a real document type, but this node renders its
    // upload as an <img> - anything that is not actually an image is refused.
    expect(
      checkCanvasImageUpload({contentType: 'application/pdf', byteSize: 1024}),
    ).toEqual({ok: false, reason: 'unsupported-type'});
    expect(ALLOWED_CANVAS_IMAGE_CONTENT_TYPES).not.toContain('application/pdf');
  });

  it('ignores a charset suffix on the content type', () => {
    expect(
      checkCanvasImageUpload({contentType: 'image/png; charset=binary', byteSize: 1024}),
    ).toEqual({ok: true});
  });
});
