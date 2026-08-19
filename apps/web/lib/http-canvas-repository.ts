/**
 * The HTTP CanvasRepository: the club's shared board, backed by services/api.
 *
 * ## There is no `subscribe`
 *
 * Same reasoning as the treasury: nothing writes the canvas except an
 * officer sitting in this app, so there is no server-side writer with no
 * browser the way the GroupMe bot is for events. Writes re-read.
 *
 * ## Bytes never travel as JSON
 *
 * An `image` node's upload goes out as multipart and its download comes
 * back as a `Blob`, which satisfies `FileBytes` in the browser - the same
 * pattern `HttpDocumentRepository` uses for uploaded documents.
 *
 * ## `boardId` is accepted but not part of any URL here
 *
 * The API resolves a club's one board from `clubId` alone
 * (`getOrCreateBoard`), so a node/edge/viewport path never names it. The
 * port still takes `boardId` because a caller always has it in hand from
 * `getOrCreateBoard` already, and a future transport might need it even if
 * this one does not.
 */

import type {
  CanvasBoard,
  CanvasEdge,
  CanvasEdgeDraft,
  CanvasNode,
  CanvasNodeContentPatch,
  CanvasNodeDraft,
  CanvasNodeGeometryPatch,
  CanvasRepository,
  CanvasViewportPatch,
  FileBytes,
} from '@cos/core';

import {ApiError, readErrorMessage} from './api-error';
import {apiFetch} from './auth-client';

export class HttpCanvasRepository implements CanvasRepository {
  async getOrCreateBoard(clubId: string): Promise<CanvasBoard> {
    return this.#request<CanvasBoard>(this.#boardPath(clubId));
  }

  async listNodes(clubId: string): Promise<CanvasNode[]> {
    return this.#request<CanvasNode[]>(this.#nodesPath(clubId));
  }

  async createNode(
    clubId: string,
    _boardId: string,
    draft: CanvasNodeDraft,
    file?: FileBytes & {name: string},
  ): Promise<CanvasNode> {
    if (draft.nodeType === 'image') {
      if (!file) {
        throw new Error('An image node needs the file to upload');
      }

      const form = new FormData();
      form.append('file', await toBlob(file), file.name);
      form.append('positionX', String(draft.positionX));
      form.append('positionY', String(draft.positionY));
      form.append('width', String(draft.width));
      form.append('height', String(draft.height));

      return this.#request<CanvasNode>(this.#nodesPath(clubId), {
        method: 'POST',
        body: form,
      });
    }

    if (file) {
      // Refused rather than ignored: silently dropping an upload because the
      // draft named a non-image kind is how a file goes missing without
      // anyone finding out until they look for it.
      throw new Error('Only an image node can carry a file');
    }

    return this.#request<CanvasNode>(this.#nodesPath(clubId), {
      method: 'POST',
      body: JSON.stringify(draft),
    });
  }

  async updateNodeGeometry(
    clubId: string,
    nodeId: string,
    patch: CanvasNodeGeometryPatch,
  ): Promise<CanvasNode> {
    return this.#request<CanvasNode>(
      `${this.#nodePath(clubId, nodeId)}/geometry`,
      {method: 'PATCH', body: JSON.stringify(patch)},
    );
  }

  async updateNodeContent(
    clubId: string,
    nodeId: string,
    patch: CanvasNodeContentPatch,
  ): Promise<CanvasNode> {
    return this.#request<CanvasNode>(
      `${this.#nodePath(clubId, nodeId)}/content`,
      {method: 'PATCH', body: JSON.stringify(patch)},
    );
  }

  async deleteNode(clubId: string, nodeId: string): Promise<void> {
    await this.#request<void>(
      this.#nodePath(clubId, nodeId),
      {method: 'DELETE'},
      false,
    );
  }

  async downloadImage(clubId: string, nodeId: string): Promise<FileBytes> {
    const response = await apiFetch(`${this.#nodePath(clubId, nodeId)}/image`);
    if (!response.ok) {
      throw new ApiError(response.status, await readErrorMessage(response));
    }
    // A Blob is a FileBytes: it has `size`, `type`, and `arrayBuffer()`.
    return response.blob();
  }

  async listEdges(clubId: string): Promise<CanvasEdge[]> {
    return this.#request<CanvasEdge[]>(this.#edgesPath(clubId));
  }

  async createEdge(
    clubId: string,
    _boardId: string,
    draft: CanvasEdgeDraft,
  ): Promise<CanvasEdge> {
    return this.#request<CanvasEdge>(this.#edgesPath(clubId), {
      method: 'POST',
      body: JSON.stringify(draft),
    });
  }

  async deleteEdge(clubId: string, edgeId: string): Promise<void> {
    await this.#request<void>(
      `${this.#edgesPath(clubId)}/${encodeURIComponent(edgeId)}`,
      {method: 'DELETE'},
      false,
    );
  }

  async updateViewport(
    clubId: string,
    _boardId: string,
    patch: CanvasViewportPatch,
  ): Promise<CanvasBoard> {
    return this.#request<CanvasBoard>(`${this.#boardPath(clubId)}/viewport`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  }

  // --- requests -----------------------------------------------------------

  #boardPath(clubId: string): string {
    return `/api/clubs/${encodeURIComponent(clubId)}/canvas/board`;
  }

  #nodesPath(clubId: string): string {
    return `${this.#boardPath(clubId)}/nodes`;
  }

  #nodePath(clubId: string, nodeId: string): string {
    return `${this.#nodesPath(clubId)}/${encodeURIComponent(nodeId)}`;
  }

  #edgesPath(clubId: string): string {
    return `${this.#boardPath(clubId)}/edges`;
  }

  async #request<T>(
    path: string,
    init: RequestInit = {},
    expectBody = true,
  ): Promise<T> {
    const response = await apiFetch(path, init);

    if (!response.ok) {
      throw new ApiError(response.status, await readErrorMessage(response));
    }

    // DELETE answers 204 with no body; calling .json() on it throws.
    if (!expectBody || response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }
}

/**
 * The bytes as something `FormData` accepts. Mirrors
 * `http-document-repository.ts`'s `toBlob`.
 */
async function toBlob(file: FileBytes): Promise<Blob> {
  if (file instanceof Blob) {
    return file;
  }
  return new Blob([await file.arrayBuffer()], {type: file.type});
}
