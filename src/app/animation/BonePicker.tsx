import { readRigDocumentSettings } from '@/core/rig/RigDocument';
import type { AnimationSession } from './AnimationSession';

type Props = {
  session: AnimationSession;
  onRefresh: () => void;
  onClose: () => void;
};

function pickBone(session: AnimationSession, matcher: (name: string) => boolean) {
  const settings = readRigDocumentSettings(session.rigDocument);
  const armature = settings.armatureId ? session.project.armatures.get(settings.armatureId) : null;
  return Array.from(armature?.bones.values() ?? []).find((bone) => matcher(bone.name.toLowerCase()));
}

export function BonePicker({ session, onRefresh, onClose }: Props) {
  const settings = readRigDocumentSettings(session.rigDocument);
  const armature = settings.armatureId ? session.project.armatures.get(settings.armatureId) : null;
  const rootId = armature?.rootBoneIds[0];

  const select = (id: string | undefined) => {
    if (!id) return;
    session.selectedBoneId = id;
    onRefresh();
  };

  const byName = (includes: string[]) =>
    pickBone(session, (name) => includes.some((part) => name.includes(part)))?.id;

  return (
    <div className="anim-bone-picker" role="dialog" aria-label="Bone picker">
      <button type="button" className="anim-picker-slot is-head" onClick={() => select(byName(['head']))}>
        Head
      </button>
      <div className="anim-picker-row">
        <button type="button" onClick={() => select(byName(['arm.l', 'shoulder.l', 'upper_arm.l']))}>Arm.L</button>
        <button type="button" onClick={() => select(byName(['chest', 'spine']))}>Chest</button>
        <button type="button" onClick={() => select(byName(['arm.r', 'shoulder.r', 'upper_arm.r']))}>Arm.R</button>
      </div>
      <button type="button" className="anim-picker-slot" onClick={() => select(byName(['pelvis', 'hips', 'hip']))}>
        Pelvis
      </button>
      <div className="anim-picker-row">
        <button type="button" onClick={() => select(byName(['thigh.l', 'leg.l']))}>Leg.L</button>
        <span />
        <button type="button" onClick={() => select(byName(['thigh.r', 'leg.r']))}>Leg.R</button>
      </div>
      <button type="button" className="anim-picker-slot" onClick={() => select(rootId)}>
        Root
      </button>
      <button type="button" className="anim-picker-close" onClick={onClose}>
        Close
      </button>
    </div>
  );
}
