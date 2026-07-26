import { describe, expect, it } from 'vitest';
import { createEmptyDocument } from '@/core/document/ModelDocument';
import {
  deserializeProject,
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

describe('ProjectSerializer migrations', () => {
  it('writes the current format with save metadata', () => {
    const encoded = JSON.parse(serializeProject(createEmptyDocument(), 'test'));
    expect(encoded.formatVersion).toBe(PROJECT_FORMAT_VERSION);
    expect(Number.isNaN(Date.parse(encoded.savedAt))).toBe(false);
  });

  it('migrates v1 project settings without losing existing values', () => {
    const encoded = JSON.parse(serializeProject(createEmptyDocument(), 'legacy'));
    encoded.formatVersion = 1;
    delete encoded.document.settings.angleSnapDegrees;
    delete encoded.document.settings.snapIncrement;
    encoded.checksum = checksum(JSON.stringify(encoded.document));

    const loaded = deserializeProject(JSON.stringify(encoded));
    expect(loaded.settings.angleSnapDegrees).toBe(15);
    expect(loaded.settings.snapIncrement).toBe(0.25);
  });

  it('adds complete symmetry defaults to projects saved before symmetry existed', () => {
    const encoded = JSON.parse(serializeProject(createEmptyDocument(), 'legacy-symmetry'));
    delete encoded.document.settings.modellingProfile;
    delete encoded.document.settings.symmetry;
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
