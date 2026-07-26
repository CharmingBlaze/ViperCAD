import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  chooseNativeSaveTarget,
  openNativeFile,
  VIPER_PROJECT_FILE,
  writeNativeFile,
} from '@/app/platform/FileDialogs';

type FakeWindow = {
  showOpenFilePicker?: ReturnType<typeof vi.fn>;
  showSaveFilePicker?: ReturnType<typeof vi.fn>;
  viperDesktopFiles?: {
    open: ReturnType<typeof vi.fn>;
    chooseSave: ReturnType<typeof vi.fn>;
    write: ReturnType<typeof vi.fn>;
  };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('native file dialogs', () => {
  it('opens projects through the browser native picker', async () => {
    const file = new File(['project'], 'model.viper', { type: 'application/json' });
    const handle = {
      name: file.name,
      getFile: vi.fn().mockResolvedValue(file),
      createWritable: vi.fn(),
    };
    const picker = vi.fn().mockResolvedValue([handle]);
    const fakeWindow: FakeWindow = { showOpenFilePicker: picker };
    vi.stubGlobal('window', fakeWindow);

    const opened = await openNativeFile({ types: [VIPER_PROJECT_FILE] });

    expect(opened?.file).toBe(file);
    expect(opened?.token.kind).toBe('browser');
    expect(picker).toHaveBeenCalledWith({
      multiple: false,
      types: [VIPER_PROJECT_FILE],
      excludeAcceptAllOption: true,
    });
  });

  it('reuses an existing save handle without reopening the dialog', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);
    const handle = {
      name: 'model.viper',
      getFile: vi.fn(),
      createWritable: vi.fn().mockResolvedValue({ write, close }),
    };
    const picker = vi.fn();
    const fakeWindow: FakeWindow = { showSaveFilePicker: picker };
    vi.stubGlobal('window', fakeWindow);

    const target = await chooseNativeSaveTarget({
      suggestedName: 'model.viper',
      types: [VIPER_PROJECT_FILE],
      existing: { kind: 'browser', handle },
    });
    expect(target).not.toBeNull();
    await writeNativeFile(target!, '{"version":1}', 'application/json');

    expect(picker).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledOnce();
    expect(write.mock.calls[0][0]).toBeInstanceOf(Blob);
    expect(close).toHaveBeenCalledOnce();
  });

  it('routes desktop saves through the preload bridge', async () => {
    const bridge = {
      open: vi.fn(),
      chooseSave: vi.fn().mockResolvedValue({ name: 'part.glb', token: 'save-1' }),
      write: vi.fn().mockResolvedValue(undefined),
    };
    const fakeWindow: FakeWindow = { viperDesktopFiles: bridge };
    vi.stubGlobal('window', fakeWindow);

    const target = await chooseNativeSaveTarget({
      suggestedName: 'part.glb',
      types: [{ description: 'glTF Binary', accept: { 'model/gltf-binary': ['.glb'] } }],
    });
    expect(target?.token).toEqual({ kind: 'desktop', id: 'save-1' });

    await writeNativeFile(target!, new Uint8Array([1, 2, 3]), 'model/gltf-binary');
    expect(bridge.write).toHaveBeenCalledWith('save-1', expect.any(ArrayBuffer));
  });

  it('treats a cancelled picker as no selection', async () => {
    const picker = vi.fn().mockRejectedValue(new DOMException('Cancelled', 'AbortError'));
    const fakeWindow: FakeWindow = { showOpenFilePicker: picker };
    vi.stubGlobal('window', fakeWindow);

    await expect(openNativeFile({ types: [VIPER_PROJECT_FILE] })).resolves.toBeNull();
  });
});
