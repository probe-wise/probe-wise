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

const SHAPES = new Set(["rectangle", "ellipse", "diamond"]);
const str = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
const bindingId = (v: unknown) =>
  v && typeof v === "object" && typeof (v as { elementId?: unknown }).elementId === "string"
    ? (v as { elementId: string }).elementId
    : null;

/**
 * A plain-text reading of the board for the AI assessment: labelled components, the
 * arrows between them and free-standing text. Excalidraw keeps a shape's label in a
 * separate text element whose containerId points at the shape.
 */
export function describeBoard(elements: readonly BoardElement[]) {
  const live = elements.filter((el) => !el.isDeleted);
  const labels = new Map<string, string>();
  for (const el of live) {
    const container = typeof el.containerId === "string" ? el.containerId : null;
    if (el.type === "text" && container) labels.set(container, str(el.text));
  }
  const name = (id: string | null) => (id && labels.get(id)) || (id ? "an unlabelled shape" : "nothing");

  const components = live.filter((el) => SHAPES.has(String(el.type))).map((el) => labels.get(el.id) || `(unlabelled ${el.type})`);
  const arrows = live
    .filter((el) => el.type === "arrow" || el.type === "line")
    .map((el) => {
      const from = bindingId(el.startBinding);
      const to = bindingId(el.endBinding);
      const label = labels.get(el.id);
      if (!from && !to) return label ? `A loose ${el.type} labelled "${label}"` : null;
      return `${name(from)} → ${name(to)}${label ? ` ("${label}")` : ""}`;
    })
    .filter((a): a is string => Boolean(a));
  const notes = live
    .filter((el) => el.type === "text" && typeof el.containerId !== "string")
    .map((el) => str(el.text))
    .filter(Boolean);
  const freehand = live.filter((el) => el.type === "freedraw").length;

  if (!components.length && !arrows.length && !notes.length && !freehand) return "The board was empty.";
  return [
    components.length ? `Components (${components.length}):\n${components.map((c) => `- ${c}`).join("\n")}` : "",
    arrows.length ? `Connections (${arrows.length}):\n${arrows.map((a) => `- ${a}`).join("\n")}` : "",
    notes.length ? `Text on the board:\n${notes.map((n) => `- ${n}`).join("\n")}` : "",
    freehand ? `Plus ${freehand} freehand stroke${freehand === 1 ? "" : "s"} (not readable as text).` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}
