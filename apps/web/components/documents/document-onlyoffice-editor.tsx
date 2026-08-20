'use client';

/**
 * A real docx/xlsx/pptx editor, embedded via OnlyOffice Docs CE.
 *
 * Unlike `DocumentCollabEditor`, this shares no code with the Yjs work - it
 * brings its own real-time collaboration engine entirely inside the
 * OnlyOffice document server, and this component's only job is to load its
 * script and hand it a signed config from `GET .../onlyoffice-config`. See
 * `docker-compose.yml` and `services/api/src/routes/onlyoffice.ts` for the
 * rest of the integration.
 *
 * Optional at the deployment level: a self-hoster who never runs the
 * `onlyoffice` container gets a plain "not set up" message here rather than
 * a broken editor, and every other document kind is entirely unaffected.
 */

import {useEffect, useId, useRef, useState} from 'react';
import {Banner} from '@astryxdesign/core/Banner';
import {Skeleton} from '@astryxdesign/core/Skeleton';

import {apiFetch} from '../../lib/auth-client';

const ONLYOFFICE_URL =
  process.env.NEXT_PUBLIC_ONLYOFFICE_URL ?? 'http://localhost:8082';

interface DocEditorInstance {
  destroyEditor?: () => void;
}

declare global {
  interface Window {
    DocsAPI?: {
      DocEditor: new (rootId: string, config: unknown) => DocEditorInstance;
    };
  }
}

let scriptPromise: Promise<void> | null = null;

/** Loads OnlyOffice's own JS API once per page, reused across every mount. */
function loadOnlyOfficeScript(): Promise<void> {
  if (window.DocsAPI) {
    return Promise.resolve();
  }
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `${ONLYOFFICE_URL}/web-apps/apps/api/documents/api.js`;
      script.onload = () => resolve();
      script.onerror = () => {
        scriptPromise = null;
        reject(new Error('Failed to load the OnlyOffice editor script'));
      };
      document.body.appendChild(script);
    });
  }
  return scriptPromise;
}

interface DocumentOnlyOfficeEditorProps {
  clubId: string;
  documentId: string;
}

export function DocumentOnlyOfficeEditor({
  clubId,
  documentId,
}: DocumentOnlyOfficeEditorProps) {
  const rootId = useId().replace(/:/g, '');
  const editorRef = useRef<DocEditorInstance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setIsReady(false);

    async function mount() {
      const response = await apiFetch(
        `/api/clubs/${clubId}/documents/${documentId}/onlyoffice-config`,
      );
      if (cancelled) {
        return;
      }
      if (response.status === 503) {
        setError(
          "This deployment hasn't set up OnlyOffice - download the file and edit it locally instead.",
        );
        return;
      }
      if (!response.ok) {
        setError("Couldn't open this document for editing.");
        return;
      }
      const config: unknown = await response.json();

      try {
        await loadOnlyOfficeScript();
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
        return;
      }
      if (cancelled || !window.DocsAPI) {
        return;
      }

      editorRef.current = new window.DocsAPI.DocEditor(rootId, config);
      setIsReady(true);
    }

    void mount();

    return () => {
      cancelled = true;
      editorRef.current?.destroyEditor?.();
      editorRef.current = null;
    };
  }, [clubId, documentId, rootId]);

  if (error) {
    return <Banner status="error" title={error} />;
  }

  return (
    <div style={{position: 'relative', height: 800}}>
      {!isReady ? <Skeleton height={800} /> : null}
      <div id={rootId} style={{height: '100%'}} />
    </div>
  );
}
