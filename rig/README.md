# ViperRig

Companion rigging, skinning, and animation app for ViperCAD. Shares the project format (v4) and syncs live with the main editor via **ViperLink**.

## Features

### Armature
- Default humanoid armature on quick setup
- **Edit mode** — add, extrude, delete, rename bones; edit rest transforms and scale
- **Pose mode** — pose bones with keyframed animation; apply pose as rest; reset rest pose
- Viewport bone picking (click bone lines)

### Skinning
- Hierarchy-aware **envelope weights** (bone segment distance, object transform aware)
- **Weight paint** mode with add/subtract brush
- Rebind weights without duplicating bindings

### Animation
- Multiple **animation clips** per rig (create, duplicate, delete, switch)
- Frame-accurate timeline (FPS, frame step, scrubber)
- Keyframe insert/delete per bone
- Linear transform interpolation (position, rotation, scale)

### Integration
- Opens from ViperCAD **Animate** button (`/rig/?projectId=…`)
- **Sync to ViperCAD** pushes rig data back to the main project
- ViperCAD model viewport shows **posed skinned preview** when a rig is linked (static mesh hidden)

## Run

```bash
npm run dev          # ViperCAD + ViperRig at http://localhost:5173/rig/
npm run dev:rig      # Rig only (port 5174)
```

## Workflow

1. Model meshes in ViperCAD
2. Click **Animate** → ViperRig opens with project linked
3. **Quick setup** creates armature + auto-weights
4. **Pose** bones, keyframe on timeline, add clips as needed
5. **Sync to ViperCAD** — preview animation on the model in the main viewport
