// Form-value hygiene shared by the Server Actions.

/** Trim, normalise unicode, drop control characters and collapse whitespace. */
export function cleanText(raw: unknown): string {
  return String(raw ?? "")
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f​-‍﻿]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Multi-line text: like cleanText per line, but keeps line breaks (notes, summaries). */
export function cleanMultiline(raw: unknown): string {
  return String(raw ?? "")
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
