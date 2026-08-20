/**
 * Tests for the OnlyOffice JWT/config helpers.
 *
 * `env.ts` is a module-level singleton read once at import time, so testing
 * both the "configured" and "not configured" (no `ONLYOFFICE_JWT_SECRET`)
 * paths deterministically - without depending on whatever happens to be in
 * `.env` or CI's environment - means resetting the module registry and
 * re-importing with `process.env` set differently before each import. That
 * is what `withOnlyOffice`/`withoutOnlyOffice` do below, rather than relying
 * on ambient environment state the way the WS integration tests can afford
 * to for Postgres/MinIO.
 */

import {afterEach, beforeEach, describe, expect, it} from 'vitest';

const ORIGINAL_SECRET = process.env['ONLYOFFICE_JWT_SECRET'];
const TEST_SECRET = 'test-only-onlyoffice-secret-not-real';

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) {
    delete process.env['ONLYOFFICE_JWT_SECRET'];
  } else {
    process.env['ONLYOFFICE_JWT_SECRET'] = ORIGINAL_SECRET;
  }
});

async function withOnlyOffice() {
  process.env['ONLYOFFICE_JWT_SECRET'] = TEST_SECRET;
  const {vi} = await import('vitest');
  vi.resetModules();
  return import('./onlyoffice.js');
}

async function withoutOnlyOffice() {
  delete process.env['ONLYOFFICE_JWT_SECRET'];
  const {vi} = await import('vitest');
  vi.resetModules();
  return import('./onlyoffice.js');
}

const CLUB_DOC = {
  id: 'doc_1',
  clubId: 'club_1',
  kind: 'file' as const,
  section: 'other' as const,
  title: 'Agenda',
  summary: '',
  status: 'published' as const,
  version: 3,
  file: {
    name: 'agenda.docx',
    contentType:
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    byteSize: 1024,
  },
  content: null,
  createdBy: 'Avery Officer',
  updatedBy: 'Avery Officer',
  createdAt: '2026-08-20T00:00:00.000Z',
  updatedAt: '2026-08-20T00:00:00.000Z',
};

describe('when ONLYOFFICE_JWT_SECRET is unset', () => {
  it('reports itself as not configured', async () => {
    const mod = await withoutOnlyOffice();
    expect(mod.isOnlyOfficeConfigured()).toBe(false);
  });

  it('refuses to build a config', async () => {
    const mod = await withoutOnlyOffice();
    expect(
      mod.buildOnlyOfficeConfig(
        CLUB_DOC,
        {id: 'user_1', name: 'Avery'},
        true,
        'https://api.example.com/download',
        'https://api.example.com/callback',
      ),
    ).toBeNull();
  });

  it('refuses to mint a download token', async () => {
    const mod = await withoutOnlyOffice();
    expect(mod.mintOnlyOfficeDownloadToken('club_1', 'doc_1')).toBeNull();
  });
});

describe('when ONLYOFFICE_JWT_SECRET is set', () => {
  it('reports itself as configured', async () => {
    const mod = await withOnlyOffice();
    expect(mod.isOnlyOfficeConfigured()).toBe(true);
  });

  it('builds a signed config for a supported Office file', async () => {
    const mod = await withOnlyOffice();
    const config = mod.buildOnlyOfficeConfig(
      CLUB_DOC,
      {id: 'user_1', name: 'Avery'},
      true,
      'https://api.example.com/download',
      'https://api.example.com/callback',
    );
    expect(config?.documentType).toBe('word');
    expect(config?.document.fileType).toBe('docx');
    // The key must change whenever the file's content does - it is derived
    // from the document's own version counter for exactly that reason.
    expect(config?.document.key).toBe('doc_1-v3');
    expect(config?.editorConfig.mode).toBe('edit');
    expect(config?.token).toBeTruthy();
  });

  it('sets view mode and refuses download-as-edit when the caller cannot edit', async () => {
    const mod = await withOnlyOffice();
    const config = mod.buildOnlyOfficeConfig(
      CLUB_DOC,
      {id: 'user_1', name: 'Avery'},
      false,
      'https://api.example.com/download',
      'https://api.example.com/callback',
    );
    expect(config?.editorConfig.mode).toBe('view');
    expect(config?.document.permissions.edit).toBe(false);
  });

  it('refuses a document type OnlyOffice does not understand', async () => {
    const mod = await withOnlyOffice();
    const config = mod.buildOnlyOfficeConfig(
      {...CLUB_DOC, file: {...CLUB_DOC.file, contentType: 'application/pdf'}},
      {id: 'user_1', name: 'Avery'},
      true,
      'https://api.example.com/download',
      'https://api.example.com/callback',
    );
    expect(config).toBeNull();
  });

  it('mints a download token that verifies back to the same ids', async () => {
    const mod = await withOnlyOffice();
    const token = mod.mintOnlyOfficeDownloadToken('club_1', 'doc_1');
    expect(token).toBeTruthy();
    const verified = mod.verifyOnlyOfficeDownloadToken(token!);
    expect(verified).toEqual({clubId: 'club_1', documentId: 'doc_1'});
  });

  it('refuses a tampered download token', async () => {
    const mod = await withOnlyOffice();
    const token = mod.mintOnlyOfficeDownloadToken('club_1', 'doc_1');
    expect(mod.verifyOnlyOfficeDownloadToken(`${token}tampered`)).toBeNull();
  });

  it('verifies a callback body signed the way OnlyOffice signs it (JWT_IN_BODY)', async () => {
    const mod = await withOnlyOffice();
    const jwt = (await import('jsonwebtoken')).default;
    const payload = {status: 2, url: 'https://onlyoffice.example.com/saved.docx', key: 'k'};
    const token = jwt.sign(payload, TEST_SECRET, {algorithm: 'HS256'});
    // toMatchObject, not toEqual: jwt.sign adds its own `iat` claim, which
    // is harmless (nothing here reads it) but not part of what was asserted.
    expect(mod.verifyOnlyOfficeCallback({token})).toMatchObject(payload);
  });

  it('also accepts a callback nested under `payload`', async () => {
    const mod = await withOnlyOffice();
    const jwt = (await import('jsonwebtoken')).default;
    const payload = {status: 2, url: 'https://onlyoffice.example.com/saved.docx'};
    const token = jwt.sign({payload}, TEST_SECRET, {algorithm: 'HS256'});
    const verified = mod.verifyOnlyOfficeCallback({token});
    expect(verified?.status).toBe(2);
    expect(verified?.url).toBe(payload.url);
  });

  it('refuses a callback signed with the wrong secret', async () => {
    const mod = await withOnlyOffice();
    const jwt = (await import('jsonwebtoken')).default;
    const token = jwt.sign({status: 2}, 'a-different-secret', {algorithm: 'HS256'});
    expect(mod.verifyOnlyOfficeCallback({token})).toBeNull();
  });

  it('refuses a callback body with no token at all', async () => {
    const mod = await withOnlyOffice();
    expect(mod.verifyOnlyOfficeCallback({status: 2})).toBeNull();
  });
});
