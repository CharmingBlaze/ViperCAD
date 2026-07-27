import { describe, expect, it } from 'vitest';
import { createEmptyDocument } from '@/core/document/ModelDocument';
import type { ModelDocument } from '@/core/document/types';
import {
  deserializeProject,
  PROJECT_FORMAT,
  PROJECT_FORMAT_VERSION,
  serializeProject,
} from '@/core/persistence/ProjectSerializer';

function checksum(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function legacyV1Payload(doc: ModelDocument, formatVersion = 1) {
  const document = {
    id: doc.id,
    name: doc.name,
    version: doc.version,
    rootObjectIds: [...doc.rootObjectIds],
    settings: { ...doc.settings, symmetry: { ...doc.settings.symmetry } },
    objects: [],
    meshes: [],
    materials: [...doc.materials.values()],
    textures: [...doc.textures.values()],
    images: [...doc.images.values()].map((image) => ({
      ...image,
      pixels: [...image.pixels],
    })),
  };
  return {
    format: PROJECT_FORMAT,
    formatVersion,
    applicationVersion: 'legacy',
    document,
    checksum: checksum(JSON.stringify(document)),
  };
}

describe('ProjectSerializer migrations', () => {
  it('writes the current format with save metadata', () => {
    const encoded = JSON.parse(serializeProject(createEmptyDocument(), 'test'));
    expect(encoded.formatVersion).toBe(PROJECT_FORMAT_VERSION);
    expect(Number.isNaN(Date.parse(encoded.savedAt))).toBe(false);
    expect(encoded.project).toBeDefined();
  });

  it('migrates v1 project settings without losing existing values', () => {
    const encoded = legacyV1Payload(createEmptyDocument(), 1);
    const settings = encoded.document.settings as Record<string, unknown>;
    delete settings.angleSnapDegrees;
    delete settings.snapIncrement;
    encoded.checksum = checksum(JSON.stringify(encoded.document));

    const loaded = deserializeProject(JSON.stringify(encoded));
    expect(loaded.settings.angleSnapDegrees).toBe(15);
    expect(loaded.settings.snapIncrement).toBe(0.25);
  });

  it('adds complete symmetry defaults to projects saved before symmetry existed', () => {
    const encoded = legacyV1Payload(createEmptyDocument());
    const settings = encoded.document.settings as Record<string, unknown>;
    delete settings.modellingProfile;
    delete settings.symmetry;
    encoded.checksum = checksum(JSON.stringify(encoded.document));

    const loaded = deserializeProject(JSON.stringify(encoded));
    expect(loaded.settings.modellingProfile).toBe('general');
    expect(loaded.settings.symmetry).toMatchObject({
      x: false,
      y: false,
      z: false,
      radialEnabled: false,
      radialAxis: 'y',
      radialCount: 8,
      liveMirror: true,
    });
  });

  it('rejects project versions newer than the application', () => {
    const encoded = JSON.parse(serializeProject(createEmptyDocument(), 'future'));
    encoded.formatVersion = PROJECT_FORMAT_VERSION + 1;
    expect(() => deserializeProject(JSON.stringify(encoded))).toThrow(/newer than supported/);
  });
});
