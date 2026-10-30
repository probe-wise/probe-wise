// Whiteboard merge rule (ADR 0003). The SQL function public.merge_board() applies the
// same rule when deltas are saved, so the live view and the record always agree.

export type BoardElement = {
  id: string;
  version: number;
  versionNonce: number;
  isDeleted?: boolean;
  type?: string;
  [key: string]: unknown;
};

/** True when `incoming` should replace `current`: higher version wins; ties go to the lower nonce. */
export function wins(incoming: BoardElement, current: BoardElement | undefined) {
  if (!current) return true;
  if (incoming.version !== current.version) return incoming.version > current.version;
  return incoming.versionNonce < current.versionNonce;
}

/** Merge deltas into a board. Existing elements keep their position; new ones are appended. */
export function mergeBoard(current: readonly BoardElement[], incoming: readonly BoardElement[]): BoardElement[] {
  const out = [...current];
  const index = new Map(out.map((el, i) => [el.id, i]));
  for (const el of incoming) {
    const i = index.get(el.id);
    if (i === undefined) {
      index.set(el.id, out.length);
      out.push(el);
    } else if (wins(el, out[i])) {
      out[i] = el;
    }
  }
  return out;
}

/**
 * Tracks which elements changed since they were last sent, so each save carries only deltas.
 * Keyed by id → `version:nonce`.
 */
export class BoardDeltaTracker {
  private sent = new Map<string, string>();

  constructor(initial: readonly BoardElement[] = []) {
    this.markSent(initial);
  }

  changed(elements: readonly BoardElement[]) {
    return elements.filter((el) => this.sent.get(el.id) !== `${el.version}:${el.versionNonce}`);
  }

  markSent(elements: readonly BoardElement[]) {
    for (const el of elements) this.sent.set(el.id, `${el.version}:${el.versionNonce}`);
  }
}

/** Elements a viewer would see (tombstones removed). */
export const visibleElements = (board: readonly BoardElement[]) => board.filter((el) => !el.isDeleted);

/** Splits deltas into chunks the database accepts (≤ 500 elements, ≤ ~200 KB each). */
export function chunkDeltas(elements: readonly BoardElement[], maxCount = 500, maxBytes = 200_000) {
  const chunks: BoardElement[][] = [];
  let current: BoardElement[] = [];
  let bytes = 0;
  for (const el of elements) {
    const size = JSON.stringify(el).length;
    if (current.length && (current.length >= maxCount || bytes + size > maxBytes)) {
      chunks.push(current);
      current = [];
      bytes = 0;
    }
    current.push(el);
    bytes += size;
  }
  if (current.length) chunks.push(current);
  return chunks;
}
