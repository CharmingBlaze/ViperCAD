# Model / Group / Level / Instance — Implementation Plan

## Phase 1 — Explicit Group type ✅ (this change set)

- Add `SceneObject.kind` and `instanceSourceModelId` (reserved for Phase 3).
- Migrate legacy objects on load via `migrateSceneObjectKind` / `normalizeSceneObject`.
- Create groups with `kind: 'group'` (no `metadata.prefab`).
- Replace implicit group detection with `isGroupObject()` → `kind === 'group'`.
- Group Focus Mode: `focusGroupId` on `EditorSession`, scoped picking/selection/marquee, viewport ghosting, outliner breadcrumb, Escape to exit one level.
- Tests: kind migration, group create/undo/paste, focus selection boundaries.
- **Unchanged:** single-document `ModelDocument`, project format v2, no Instances yet.

## Phase 2 — Project and document structure

- Introduce `ViperProject`, `ViperDocument` (`kind: 'model' | 'level'`), document-owned object maps.
- Document tabs and per-document editor sessions (`ProjectEditor` / scoped `EditorSession`).
- Project panel (Models + Levels).
- Persistence format v3; migrate v1/v2 projects → one Level document.
- Tests: document isolation, migration round-trip.

## Phase 3 — Instances

- `kind: 'instance'` objects in Levels, derived rendering, linked duplication.
- Model placement workflow; automatic updates when source Model revision changes.
- Tests: placement, linked updates, duplication stays linked.

## Phase 4 — Asset workflow

- Create Model from Selection, Set Model Origin, Make Unique, model deletion guards.
- Model export; Level export with evaluated Instances.

## Phase 5 — ViperAnimate integration

- Send selected/open Model (not entire Level) with `AnimationSourceLink`.

## Compatibility notes

- Existing `.viper` files load unchanged; objects without `kind` are normalized on deserialize.
- Old prefab groups (`metadata.prefab === 'true'`) become explicit groups; prefab metadata is stripped.
