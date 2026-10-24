import { POLL_OPTIONS, isPollOptionId, type PollOptionId } from './poll';

export interface PollResults {
  totals: Record<PollOptionId, number>;
  total: number;
  myVote: PollOptionId | null;
}

const ENDPOINT = '/api/poll';
const TIMEOUT_MS = 5000;

function emptyTotals(): Record<PollOptionId, number> {
  return Object.fromEntries(POLL_OPTIONS.map((option) => [option.id, 0])) as Record<
    PollOptionId,
    number
  >;
}

function normaliseResults(value: unknown): PollResults | null {
  if (typeof value !== 'object' || value === null) return null;

  const { totals, myVote } = value as { totals?: unknown; myVote?: unknown };
  if (typeof totals !== 'object' || totals === null) return null;

  const normalised = emptyTotals();
  let total = 0;

  for (const option of POLL_OPTIONS) {
    const raw = (totals as Record<string, unknown>)[option.id];
    const count =
      typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, Math.trunc(raw)) : 0;
    normalised[option.id] = count;
    total += count;
  }

  return {
    totals: normalised,
    total,
    myVote: isPollOptionId(myVote) ? myVote : null,
  };
}

async function request(method: 'GET' | 'POST' | 'DELETE', body?: unknown): Promise<PollResults | null> {
  try {
    const response = await fetch(ENDPOINT, {
      method,
      headers: {
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) return null;

    const payload: unknown = await response.json();
    return normaliseResults(payload);
  } catch {
    return null;
  }
}

export function loadPollResults(): Promise<PollResults | null> {
  return request('GET');
}

export function submitPollVote(option: PollOptionId): Promise<PollResults | null> {
  return request('POST', { option });
}

export function removePollVote(): Promise<PollResults | null> {
  return request('DELETE');
}
