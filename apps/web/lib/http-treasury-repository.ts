/**
 * The HTTP TreasuryRepository: the club's money, backed by services/api.
 *
 * ## It returns rows, never a balance
 *
 * There is no `summary()` method here and there must never be one. The three
 * numbers come from `summarizeFund` in @cos/core, folded over the lists this
 * returns. An endpoint or a method that answered "how much is left" would be a
 * second implementation of the most consequential arithmetic in the product,
 * and the two would eventually disagree - which on a money screen means a
 * confident wrong number rather than a visible error.
 *
 * ## There is no `subscribe`
 *
 * Deliberate, and the port explains it: the calendar has one because the
 * GroupMe bot writes events with no browser, so a change can originate where no
 * tab can see it. Nothing writes the treasury except an officer in this app,
 * and the bot's eventual role here is to *read* `!budget`. Writes re-read, the
 * same freshness story as the document hub.
 *
 * ## A refused write is a message, not a status code
 *
 * The API answers 400 with a sentence when a request names a fund that is not
 * this club's, a fund that is closed, or an event from another club, and when a
 * delete targets something the club actually asked for. Those are all things a
 * person can fix, so the message is carried through to the screen rather than
 * flattened into "something went wrong".
 */

import type {
  ExpenseRequest,
  ExpenseRequestDraft,
  ExpenseRequestPatch,
  Fund,
  FundAllocation,
  FundAllocationDraft,
  FundDraft,
  FundPatch,
  RequestStatus,
  TreasuryRepository,
} from '@cos/core';

import {ApiError, readErrorMessage} from './api-error';
import {apiFetch} from './auth-client';

export class HttpTreasuryRepository implements TreasuryRepository {
  async listFunds(clubId: string): Promise<Fund[]> {
    return this.#request<Fund[]>(this.#fundsPath(clubId));
  }

  async createFund(clubId: string, draft: FundDraft): Promise<Fund> {
    return this.#request<Fund>(this.#fundsPath(clubId), {
      method: 'POST',
      body: JSON.stringify(draft),
    });
  }

  async updateFund(
    clubId: string,
    fundId: string,
    patch: FundPatch,
  ): Promise<Fund> {
    return this.#request<Fund>(this.#fundPath(clubId, fundId), {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  }

  async listAllocations(clubId: string): Promise<FundAllocation[]> {
    return this.#request<FundAllocation[]>(
      `/api/clubs/${encodeURIComponent(clubId)}/allocations`,
    );
  }

  async allocate(
    clubId: string,
    fundId: string,
    draft: FundAllocationDraft,
  ): Promise<FundAllocation> {
    return this.#request<FundAllocation>(
      `${this.#fundPath(clubId, fundId)}/allocations`,
      {method: 'POST', body: JSON.stringify(draft)},
    );
  }

  async listRequests(clubId: string): Promise<ExpenseRequest[]> {
    return this.#request<ExpenseRequest[]>(this.#requestsPath(clubId));
  }

  /**
   * Files a request.
   *
   * `status` is accepted alongside the draft because the common path is a
   * treasurer recording something they have *already* sent to the university,
   * not drafting it here first. Forcing every request to be born a draft and
   * immediately patched would add a round trip to model a step that did not
   * happen.
   */
  async createRequest(
    clubId: string,
    draft: ExpenseRequestDraft,
    status: RequestStatus = 'draft',
  ): Promise<ExpenseRequest> {
    return this.#request<ExpenseRequest>(this.#requestsPath(clubId), {
      method: 'POST',
      body: JSON.stringify({...draft, status}),
    });
  }

  async updateRequest(
    clubId: string,
    requestId: string,
    patch: ExpenseRequestPatch,
  ): Promise<ExpenseRequest> {
    return this.#request<ExpenseRequest>(
      this.#requestPath(clubId, requestId),
      {method: 'PATCH', body: JSON.stringify(patch)},
    );
  }

  async removeRequest(clubId: string, requestId: string): Promise<void> {
    await this.#request<void>(
      this.#requestPath(clubId, requestId),
      {method: 'DELETE'},
      false,
    );
  }

  // --- requests -----------------------------------------------------------

  #fundsPath(clubId: string): string {
    return `/api/clubs/${encodeURIComponent(clubId)}/funds`;
  }

  #fundPath(clubId: string, fundId: string): string {
    return `${this.#fundsPath(clubId)}/${encodeURIComponent(fundId)}`;
  }

  #requestsPath(clubId: string): string {
    return `/api/clubs/${encodeURIComponent(clubId)}/requests`;
  }

  #requestPath(clubId: string, requestId: string): string {
    return `${this.#requestsPath(clubId)}/${encodeURIComponent(requestId)}`;
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
