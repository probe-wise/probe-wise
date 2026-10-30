# 0003. Excalidraw for the shared whiteboard

- Status: Accepted
- Date: 2026-10-30

## Context

System design interviews happen on a whiteboard. We need boxes, arrows, text and freehand drawing, editable by
both participants at once, that look at home in the "whiteboard" visual identity.

## Decision

Use `@excalidraw/excalidraw` (MIT), loaded only in the interview room with `next/dynamic({ ssr: false })`.

- Each element carries `id`, `version` and `versionNonce`. Merges keep the higher `version`; ties go to the lower
  `versionNonce`. Excalidraw's own collaboration uses the same rule, and we use it in TypeScript (`mergeBoard`) and
  SQL (`_merge_board`), so the live and saved paths always agree.
- Deleted elements are tombstones (`isDeleted: true`) and sync like any other change.
- The image tool is disabled: images would need file storage and moderation.

## Consequences

- Fast to ship, familiar to engineers, hand-drawn look matches the brand.
- Large client bundle (about 1 MB gzipped), loaded only on the room and review pages.
- Excalidraw loads its fonts from a CDN by default; self-hosting them is a follow-up.

## Alternatives considered

- **tldraw**: excellent, but production use needs a licence key.
- **Custom canvas**: weeks of work to reach a worse result.
- **Mermaid/diagram-as-code**: candidates don't draw that way in interviews.
