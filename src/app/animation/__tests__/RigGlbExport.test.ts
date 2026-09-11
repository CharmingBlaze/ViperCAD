import { describe, expect, it } from 'vitest';
import { EditorSession } from '@/core/editor/EditorSession';
import { commitMeshObject } from '@/core/document/ModelDocument';
import { buildBox } from '@/core/mesh/builders/BoxBuilder';
import { AnimationSession } from '@/app/animation/AnimationSession';
import { documentHasSkinnedExport, exportRigGlb, validateGlbRoundTrip } from '@/app/GameExport';

if (typeof (globalThis as any).FileReader === 'undefined') {
  class MockFileReader {
    onload: ((ev: any) => void) | null = null;
    onloadend: ((ev: any) => void) | null = null;
    result: any = null;
    readAsArrayBuffer(blob: Blob) {
      blob.arrayBuffer().then((buf) => {
        this.result = buf;
        if (this.onload) this.onload({ target: this });
        if (this.onloadend) this.onloadend({ target: this });
      });
    }
  }
  (globalThis as any).FileReader = MockFileReader;
}

if (typeof (globalThis as any).self === 'undefined') {
  (globalThis as any).self = globalThis;
}

if (typeof (globalThis as any).document === 'undefined') {
  (globalThis as any).document = {
    createElement: (tag: string) => {
      if (tag === 'canvas') {
        const canvas: any = {
          width: 1,
          height: 1,
          style: {},
          getContext: () => ({
            drawImage: () => {},
            getImageData: () => ({ data: new Uint8ClampedArray(4) }),
            putImageData: () => {},
            translate: () => {},
            scale: () => {},
            rotate: () => {},
            fillRect: () => {},
            clearRect: () => {},
            save: () => {},
            restore: () => {},
          }),
          toBlob: (cb: (b: Blob) => void) => cb(new Blob([])),
          toDataURL: () =>
            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        };
        return canvas;
      }
      return {};
    },
  };
}

if (typeof (globalThis as any).ImageData === 'undefined') {
  class MockImageData {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    constructor(w: number, h: number) {
      this.width = w;
      this.height = h;
      this.data = new Uint8ClampedArray(w * h * 4);
    }
  }
  (globalThis as any).ImageData = MockImageData;
}

describe('Rig GLB Export for Game Engines', () => {
  it('exports rigged skinned mesh with skeleton and animation tracks', async () => {
    const editor = new EditorSession();
    editor.ensureDocumentKind('model');
    commitMeshObject(editor.document, buildBox({ width: 1, height: 1, depth: 1 }));
    const session = new AnimationSession(editor);
    session.enterForModel(editor.documentId);
    session.runQuickSetup();
    expect(documentHasSkinnedExport(editor.project, editor.document)).toBe(true);

    // Insert keyframes for the root bone
    session.seekTo(0);
    session.insertKeyframeForSelectedBone();
    session.seekTo(0.5);
    session.rotateSelectedBoneInPose(0.2, 0.1, 0.0);
    session.insertKeyframeForSelectedBone();

    // Add an animation event
    session.addEvent('footstep_l', 0.25, 'volume=0.8');

    const buffer = await exportRigGlb(session);
    expect(buffer).toBeInstanceOf(ArrayBuffer);
    expect(buffer.byteLength).toBeGreaterThan(0);

    const report = await validateGlbRoundTrip(buffer);
    expect(report.errors).toHaveLength(0);
    expect(report.meshes).toBeGreaterThan(0);
    expect(report.triangles).toBeGreaterThan(0);
    expect(report.skinnedMeshes).toBeGreaterThan(0);
    expect(report.skeletons).toBeGreaterThan(0);
    expect(report.animations).toBeGreaterThan(0);
  });
});
