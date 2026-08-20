/**
 * The bridge between this document hub's stored markdown text and the rich
 * Yjs document tree the collaborative editor (Tiptap + `@tiptap/y-tiptap`)
 * actually syncs.
 *
 * Rich collaborative editing operates on a ProseMirror document tree, not a
 * flat string - that is inherent to how Yjs merges concurrent edits at the
 * node level, and it is not something a plain `Y.Text` can express (see
 * `document-collab.ts`'s module doc for how that was discovered, live, by
 * opening the editor rather than by anything a typecheck caught). Markdown
 * only exists at the two boundaries where this tree meets the plain-text
 * world the rest of the document hub is built around:
 *
 * - **Seeding** a document that has never had a live collaborative session -
 *   parse its stored markdown into a tree once.
 * - **Compaction** - serialize the current tree back to markdown for
 *   `document_revisions.content`, which `document-history.tsx` still
 *   renders as markdown and always will (that view is unaffected by any of
 *   this; it only ever reads the materialized text).
 *
 * The schema is rebuilt here with `@tiptap/core`'s `getSchema` - a pure
 * function needing no DOM or live `Editor` instance - against the *exact*
 * extension `apps/web`'s `DocumentCollabEditor` uses (`StarterKit`), so the
 * parser and serializer below are guaranteed to agree with what the browser
 * actually writes. That agreement is the whole point: a hand-built parallel
 * schema that quietly drifted from the client's would parse or serialize
 * some content differently, and the failure mode is silent corruption, not
 * an error.
 *
 * `prosemirror-markdown`'s own `defaultMarkdownParser`/
 * `defaultMarkdownSerializer` are hardcoded to its own example schema's
 * snake_case node names (`bullet_list`, `code_block`, `hard_break`, ...).
 * Tiptap's are camelCase (`bulletList`, `codeBlock`, `hardBreak`, ...), so
 * those defaults cannot be reused directly - this is a renamed copy of them,
 * mapped onto Tiptap's names, plus `underline`, which CommonMark has no
 * native syntax for and is represented here as an inline `<u>` tag, the
 * ordinary markdown-with-inline-HTML convention.
 */

import {getSchema} from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import MarkdownIt from 'markdown-it';
import {MarkdownParser, MarkdownSerializer} from 'prosemirror-markdown';
import type {Node as ProseMirrorNode} from 'prosemirror-model';

export const documentSchema = getSchema([StarterKit]);

/**
 * Strikethrough (`~~text~~`) is a GFM extension, not part of CommonMark
 * proper, so the `commonmark` preset leaves it disabled - enabled explicitly
 * since Tiptap's `StarterKit` includes a `Strike` mark that needs somewhere
 * to round-trip to.
 */
const tokenizer = MarkdownIt('commonmark', {html: false}).enable('strikethrough');

const documentMarkdownParser = new MarkdownParser(documentSchema, tokenizer, {
  blockquote: {block: 'blockquote'},
  paragraph: {block: 'paragraph'},
  list_item: {block: 'listItem'},
  bullet_list: {block: 'bulletList'},
  ordered_list: {
    block: 'orderedList',
    getAttrs: (tok) => ({start: Number(tok.attrGet('start')) || 1}),
  },
  heading: {block: 'heading', getAttrs: (tok) => ({level: Number(tok.tag.slice(1))})},
  code_block: {block: 'codeBlock', noCloseToken: true},
  fence: {
    block: 'codeBlock',
    getAttrs: (tok) => ({language: tok.info || ''}),
    noCloseToken: true,
  },
  hr: {node: 'horizontalRule'},
  hardbreak: {node: 'hardBreak'},

  em: {mark: 'italic'},
  strong: {mark: 'bold'},
  s: {mark: 'strike'},
  link: {mark: 'link', getAttrs: (tok) => ({href: tok.attrGet('href')})},
  code_inline: {mark: 'code', noCloseToken: true},
});

function backticksFor(node: ProseMirrorNode, side: number): string {
  const ticks = /`+/g;
  let match: RegExpExecArray | null;
  let len = 0;
  if (node.isText) {
    while ((match = ticks.exec(node.text ?? ''))) {
      len = Math.max(len, match[0].length);
    }
  }
  let result = len > 0 && side > 0 ? ' `' : '`';
  for (let i = 0; i < len; i += 1) {
    result += '`';
  }
  if (len > 0 && side < 0) {
    result += ' ';
  }
  return result;
}

const documentMarkdownSerializer = new MarkdownSerializer(
  {
    blockquote(state, node) {
      state.wrapBlock('> ', null, node, () => state.renderContent(node));
    },
    codeBlock(state, node) {
      const backticks = node.textContent.match(/`{3,}/gm);
      const fence = backticks ? `${[...backticks].sort().at(-1)}\`` : '```';
      state.write(fence + ((node.attrs['language'] as string) || '') + '\n');
      state.text(node.textContent, false);
      state.write('\n');
      state.write(fence);
      state.closeBlock(node);
    },
    heading(state, node) {
      state.write(`${state.repeat('#', node.attrs['level'] as number)} `);
      state.renderInline(node, false);
      state.closeBlock(node);
    },
    horizontalRule(state, node) {
      state.write('---');
      state.closeBlock(node);
    },
    bulletList(state, node) {
      state.renderList(node, '  ', () => '- ');
    },
    orderedList(state, node) {
      const start = (node.attrs['start'] as number | undefined) ?? 1;
      const maxWidth = String(start + node.childCount - 1).length;
      const space = state.repeat(' ', maxWidth + 2);
      state.renderList(node, space, (i) => {
        const numeral = String(start + i);
        return `${state.repeat(' ', maxWidth - numeral.length)}${numeral}. `;
      });
    },
    listItem(state, node) {
      state.renderContent(node);
    },
    paragraph(state, node) {
      state.renderInline(node);
      state.closeBlock(node);
    },
    hardBreak(state, node, parent, index) {
      for (let i = index + 1; i < parent.childCount; i += 1) {
        if (parent.child(i).type !== node.type) {
          state.write('\\\n');
          return;
        }
      }
    },
    text(state, node) {
      state.text(node.text ?? '');
    },
  },
  {
    italic: {open: '*', close: '*', mixable: true, expelEnclosingWhitespace: true},
    bold: {open: '**', close: '**', mixable: true, expelEnclosingWhitespace: true},
    strike: {open: '~~', close: '~~', mixable: true, expelEnclosingWhitespace: true},
    underline: {open: '<u>', close: '</u>', mixable: true},
    code: {
      open: (_state, _mark, parent, index) => backticksFor(parent.child(index), -1),
      close: (_state, _mark, parent, index) => backticksFor(parent.child(index - 1), 1),
      escape: false,
    },
    link: {
      open: () => '[',
      close(_state, mark) {
        const title = mark.attrs['title']
          ? ` "${String(mark.attrs['title']).replace(/"/g, '\\"')}"`
          : '';
        return `](${String(mark.attrs['href']).replace(/[()]/g, '\\$&')}${title})`;
      },
      mixable: true,
    },
  },
  {hardBreakNodeName: 'hardBreak'},
);

/** Parses stored markdown into the same rich tree the collaborative editor works with. */
export function markdownToProseMirrorDoc(markdown: string): ProseMirrorNode {
  return documentMarkdownParser.parse(markdown);
}

/** The inverse - what compaction calls to materialize a readable revision. */
export function proseMirrorDocToMarkdown(doc: ProseMirrorNode): string {
  // Tiptap's bulletList/orderedList carry no `tight` attr of their own, so
  // this call-level default is what actually governs list spacing - without
  // it, every list item round-trips with a spurious blank line between
  // entries (found by the round-trip test, not by inspection).
  return documentMarkdownSerializer.serialize(doc, {tightLists: true});
}
