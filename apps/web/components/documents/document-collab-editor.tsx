'use client';

/**
 * The live, always-on editor for a text document's content.
 *
 * Unlike the old content field in `DocumentEditor`, this is not behind an
 * "Edit" toggle - it is mounted whenever the document is open, editable for
 * whoever holds `document:edit` and read-only (but still live) for everyone
 * else. There is no save button and no version conflict to handle: every
 * keystroke is a Yjs update relayed and persisted by `services/api/src/
 * documents/document-collab.ts`, which periodically compacts the result into
 * a real `document_revisions` row - see docs/COLLABORATIVE-EDITING.md.
 *
 * `StarterKit`'s own history is disabled deliberately. Yjs owns undo for a
 * collaborative document - ProseMirror's built-in history has no concept of
 * "whose keystroke was that" and would let one person's Ctrl+Z erase another
 * person's typing.
 */

import {useEffect} from 'react';
import {Extension} from '@tiptap/core';
import {EditorContent, useEditor} from '@tiptap/react';
import {Collaboration} from '@tiptap/extension-collaboration';
import {StarterKit} from '@tiptap/starter-kit';
import {yCursorPlugin} from '@tiptap/y-tiptap';
import type {Awareness} from 'y-protocols/awareness';
import {Text} from '@astryxdesign/core/Text';
import {HStack} from '@astryxdesign/core/Stack';
import {StatusDot} from '@astryxdesign/core/StatusDot';
import {DOCUMENT_COLLAB_XML_FRAGMENT_FIELD} from '@cos/core';

import {useDocumentCollab} from '../../lib/document-collab-store';
import styles from './document-collab-editor.module.css';

interface CursorUser {
  name: string;
  color: string;
}

function buildCursor(user: CursorUser): HTMLElement {
  const cursor = document.createElement('span');
  cursor.classList.add('collaboration-cursor__caret');
  cursor.setAttribute('style', `border-color: ${user.color}`);
  const label = document.createElement('div');
  label.classList.add('collaboration-cursor__label');
  label.setAttribute('style', `background-color: ${user.color}`);
  label.appendChild(document.createTextNode(user.name));
  cursor.appendChild(label);
  return cursor;
}

function buildSelection(user: CursorUser) {
  return {
    style: `background-color: ${user.color}33`,
    class: 'collaboration-cursor__selection',
  };
}

/**
 * Renders every other connected editor's cursor and selection.
 *
 * Deliberately not `@tiptap/extension-collaboration-cursor` - that package
 * still imports `yCursorPlugin` from the standalone `y-prosemirror` package
 * (its own dependency has not caught up to Tiptap 3), and Tiptap 3's own
 * `Collaboration` extension runs `@tiptap/y-tiptap`'s *own*, differently-keyed
 * sync plugin. The two forks' plugin keys do not recognise each other, so
 * mixing them throws `Cannot read properties of undefined (reading 'doc')`
 * out of the cursor plugin's `init` the moment the editor mounts - found by
 * actually opening the editor in a browser, not by anything a typecheck or a
 * unit test would have caught. Building the cursor plugin directly from
 * `@tiptap/y-tiptap` - the same fork `Collaboration` itself uses - is what
 * keeps the two talking to the same plugin state. `buildCursor`/
 * `buildSelection` reproduce Tiptap 2's original default builders (a
 * `.collaboration-cursor__caret` span wrapping a `.collaboration-cursor__label`
 * div) so this file's own CSS module needs no separate class scheme.
 */
const DocumentCollabCursor = Extension.create<{awareness: Awareness | null}>({
  name: 'documentCollabCursor',
  addOptions() {
    return {awareness: null};
  },
  addProseMirrorPlugins() {
    if (!this.options.awareness) {
      return [];
    }
    return [
      yCursorPlugin(this.options.awareness, {
        cursorBuilder: buildCursor,
        selectionBuilder: buildSelection,
      }),
    ];
  },
});

interface DocumentCollabEditorProps {
  clubId: string;
  documentId: string;
  canEdit: boolean;
}

export function DocumentCollabEditor({
  clubId,
  documentId,
  canEdit,
}: DocumentCollabEditorProps) {
  const {ydoc, awareness, isConnected} = useDocumentCollab(
    clubId,
    documentId,
    canEdit,
  );

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({undoRedo: false}),
        Collaboration.configure({
          document: ydoc,
          field: DOCUMENT_COLLAB_XML_FRAGMENT_FIELD,
        }),
        DocumentCollabCursor.configure({awareness}),
      ],
      editable: canEdit,
      immediatelyRender: false,
    },
    [ydoc, awareness],
  );

  // `canEdit` cannot change the set of extensions without recreating the
  // editor (and losing focus/selection), so it is applied imperatively
  // instead - the one thing `useEditor`'s own `editable` option does not
  // keep in sync after the initial render.
  useEffect(() => {
    editor?.setEditable(canEdit);
  }, [editor, canEdit]);

  if (!editor) {
    return null;
  }

  return (
    <div>
      {!isConnected ? (
        <HStack gap={2} vAlign="center" style={{marginBlockEnd: 'var(--spacing-2)'}}>
          <StatusDot variant="warning" label="Reconnecting" isPulsing />
          <Text type="supporting" color="secondary">
            Reconnecting - your edits are saved locally and will sync once the
            connection returns.
          </Text>
        </HStack>
      ) : null}
      <EditorContent editor={editor} className={styles.editorContent} />
    </div>
  );
}
