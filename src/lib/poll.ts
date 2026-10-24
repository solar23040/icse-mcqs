export interface PollOption {
  id: string;
  label: string;
}

/** Options shown on /poll. Order is the order visitors see. */
export const POLL_OPTIONS = [
  { id: 'mass-media', label: 'Mass Media' },
  { id: 'physical-education', label: 'Physical Education' },
  { id: 'computer-applications', label: 'Computer Applications' },
  { id: 'hindi', label: 'Hindi' },
  { id: 'physics', label: 'Physics' },
  { id: 'chemistry', label: 'Chemistry' },
  { id: 'biology', label: 'Biology' },
  { id: 'commercial-studies', label: 'Commercial Studies' },
  { id: 'english-language', label: 'English Language' },
] as const satisfies readonly PollOption[];

export type PollOptionId = (typeof POLL_OPTIONS)[number]['id'];

export const POLL_STORAGE_KEY = 'icse:poll-next-subject';

/**
 * Mirrors the value in memory so the poll keeps working when localStorage is
 * missing or throws. `removed` prevents a failed removeItem from resurrecting
 * an old vote on the next read.
 */
let memoryValue: string | null = null;
let removed = false;

function getStorage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

export function isPollOptionId(value: unknown): value is PollOptionId {
  return typeof value === 'string' && POLL_OPTIONS.some((option) => option.id === value);
}

export function getPollVote(): PollOptionId | null {
  const storage = getStorage();

  if (storage) {
    try {
      const stored = storage.getItem(POLL_STORAGE_KEY);

      if (stored !== null) {
        if (isPollOptionId(stored)) {
          memoryValue = stored;
          removed = false;
          return stored;
        }

        // Ignore and drop values that no longer match the option list.
        try {
          storage.removeItem(POLL_STORAGE_KEY);
        } catch {
          // The invalid value is still ignored below.
        }
      }
    } catch {
      // Fall through to the in-memory copy.
    }
  }

  if (removed) return null;
  return isPollOptionId(memoryValue) ? memoryValue : null;
}

export function savePollVote(id: PollOptionId): boolean {
  if (!isPollOptionId(id)) return false;

  memoryValue = id;
  removed = false;

  const storage = getStorage();
  if (!storage) return true;

  try {
    storage.setItem(POLL_STORAGE_KEY, id);
  } catch {
    // The memory copy above is the fallback.
  }

  return true;
}

export function clearPollVote(): void {
  memoryValue = null;
  removed = true;

  const storage = getStorage();
  if (!storage) return;

  try {
    storage.removeItem(POLL_STORAGE_KEY);
  } catch {
    // The in-memory tombstone above is the fallback.
  }
}

export function pollOptionLabel(id: PollOptionId): string {
  return POLL_OPTIONS.find((option) => option.id === id)?.label ?? id;
}
