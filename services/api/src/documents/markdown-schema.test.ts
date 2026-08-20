/**
 * Round-trip tests for the markdown <-> ProseMirror tree bridge.
 *
 * These pin the actual reason this file exists: `prosemirror-markdown`'s own
 * defaults are snake_case and do not match Tiptap's schema, so every mapping
 * here is hand-written and worth its own test independent of the WS
 * integration test, which only exercises a single paragraph.
 */

import {describe, expect, it} from 'vitest';

import {markdownToProseMirrorDoc, proseMirrorDocToMarkdown} from './markdown-schema.js';

function roundTrip(markdown: string): string {
  return proseMirrorDocToMarkdown(markdownToProseMirrorDoc(markdown));
}

describe('markdown round-trip', () => {
  it('preserves a plain paragraph', () => {
    expect(roundTrip('Just a sentence.')).toBe('Just a sentence.');
  });

  it('preserves headings at every level StarterKit supports', () => {
    expect(roundTrip('# Title')).toBe('# Title');
    expect(roundTrip('### Subheading')).toBe('### Subheading');
  });

  it('preserves bold and italic', () => {
    expect(roundTrip('**bold** and *italic*')).toBe('**bold** and *italic*');
  });

  it('preserves strikethrough', () => {
    expect(roundTrip('~~gone~~')).toBe('~~gone~~');
  });

  it('preserves inline code', () => {
    expect(roundTrip('Run `pnpm test` first.')).toBe('Run `pnpm test` first.');
  });

  it('preserves a fenced code block with its language', () => {
    const markdown = '```ts\nconst x = 1;\n```';
    expect(roundTrip(markdown)).toBe(markdown);
  });

  it('preserves a bullet list', () => {
    const markdown = '- one\n- two\n- three';
    expect(roundTrip(markdown)).toBe(markdown);
  });

  it('preserves an ordered list starting from a number other than one', () => {
    const markdown = '5. five\n6. six';
    expect(roundTrip(markdown)).toBe(markdown);
  });

  it('preserves a blockquote', () => {
    expect(roundTrip('> A quoted line.')).toBe('> A quoted line.');
  });

  it('preserves a link', () => {
    expect(roundTrip('[COS](https://example.com)')).toBe(
      '[COS](https://example.com)',
    );
  });

  it('preserves multiple paragraphs separated by a blank line', () => {
    const markdown = 'First.\n\nSecond.';
    expect(roundTrip(markdown)).toBe(markdown);
  });

  it('round-trips a document mixing several elements, like a real seed document', () => {
    const markdown =
      '# Code of Conduct\n\nEveryone is welcome here. **Harassment** of any kind is not tolerated.\n\n- Be respectful\n- Ask before recording';
    expect(roundTrip(markdown)).toBe(markdown);
  });

  it('produces an empty document for empty input', () => {
    expect(markdownToProseMirrorDoc('').textContent).toBe('');
  });
});
