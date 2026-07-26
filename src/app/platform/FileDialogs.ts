export type FileDialogType = {
  description: string;
  accept: Record<string, string[]>;
};

export type FileToken =
  | { kind: 'browser'; handle: BrowserFileHandle }
  | { kind: 'desktop'; id: string };

export type OpenedFile = {
  file: File;
  token: FileToken;
};

export type SaveTarget = {
  name: string;
  token: FileToken;
};

export type OpenFileOptions = {
  types: FileDialogType[];
  multiple?: boolean;
};

export type SaveFileOptions = {
  suggestedName: string;
  types: FileDialogType[];
  existing?: FileToken | null;
};

type BrowserWritable = {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
};

type BrowserFileHandle = {
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<BrowserWritable>;
};

type PickerWindow = Window & {
  showOpenFilePicker?: (options: {
    multiple?: boolean;
    types?: FileDialogType[];
    excludeAcceptAllOption?: boolean;
  }) => Promise<BrowserFileHandle[]>;
  showSaveFilePicker?: (options: {
    suggestedName?: string;
    types?: FileDialogType[];
    excludeAcceptAllOption?: boolean;
  }) => Promise<BrowserFileHandle>;
};

type DesktopFileBridge = {
  open(options: OpenFileOptions): Promise<
    | { name: string; type?: string; bytes: ArrayBuffer; token: string }
    | null
  >;
  chooseSave(options: Omit<SaveFileOptions, 'existing'> & { existingToken?: string }): Promise<
    | { name: string; token: string }
    | null
  >;
  write(token: string, bytes: ArrayBuffer): Promise<void>;
};

declare global {
  interface Window {
    /** Future Electron/Tauri preload bridge. UI code stays unchanged. */
    viperDesktopFiles?: DesktopFileBridge;
  }
}

function isCancelled(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function unavailable(): never {
  throw new Error(
    'Native file dialogs are unavailable in this browser. Use the desktop build or a Chromium-based browser.',
  );
}

export async function openNativeFile(options: OpenFileOptions): Promise<OpenedFile | null> {
  const desktop = window.viperDesktopFiles;
  if (desktop) {
    const selected = await desktop.open(options);
    if (!selected) return null;
    return {
      file: new File([selected.bytes], selected.name, {
        type: selected.type ?? 'application/octet-stream',
      }),
      token: { kind: 'desktop', id: selected.token },
    };
  }

  const picker = (window as PickerWindow).showOpenFilePicker;
  if (!picker) return unavailable();
  try {
    const handles = await picker.call(window, {
      multiple: options.multiple ?? false,
      types: options.types,
      excludeAcceptAllOption: true,
    });
    const handle = handles[0];
    if (!handle) return null;
    return {
      file: await handle.getFile(),
      token: { kind: 'browser', handle },
    };
  } catch (error) {
    if (isCancelled(error)) return null;
    throw error;
  }
}

export async function chooseNativeSaveTarget(
  options: SaveFileOptions,
): Promise<SaveTarget | null> {
  if (options.existing) {
    if (options.existing.kind === 'browser') {
      return { name: options.existing.handle.name, token: options.existing };
    }
    const desktop = window.viperDesktopFiles;
    if (!desktop) throw new Error('The desktop file handle is no longer available');
    return { name: options.suggestedName, token: options.existing };
  }

  const desktop = window.viperDesktopFiles;
  if (desktop) {
    const selected = await desktop.chooseSave({
      suggestedName: options.suggestedName,
      types: options.types,
    });
    return selected
      ? { name: selected.name, token: { kind: 'desktop', id: selected.token } }
      : null;
  }

  const picker = (window as PickerWindow).showSaveFilePicker;
  if (!picker) return unavailable();
  try {
    const handle = await picker.call(window, {
      suggestedName: options.suggestedName,
      types: options.types,
      excludeAcceptAllOption: true,
    });
    return { name: handle.name, token: { kind: 'browser', handle } };
  } catch (error) {
    if (isCancelled(error)) return null;
    throw error;
  }
}

export async function writeNativeFile(
  target: SaveTarget,
  contents: BlobPart,
  mimeType: string,
): Promise<void> {
  const blob = new Blob([contents], { type: mimeType });
  if (target.token.kind === 'desktop') {
    const desktop = window.viperDesktopFiles;
    if (!desktop) throw new Error('The desktop file bridge is unavailable');
    await desktop.write(target.token.id, await blob.arrayBuffer());
    return;
  }
  const writable = await target.token.handle.createWritable();
  try {
    await writable.write(blob);
  } finally {
    await writable.close();
  }
}

export const VIPER_PROJECT_FILE: FileDialogType = {
  description: 'Viper CAD Project',
  accept: { 'application/json': ['.viper', '.json'] },
};

export const MODEL_IMPORT_FILES: FileDialogType[] = [
  { description: 'Wavefront OBJ', accept: { 'text/plain': ['.obj'] } },
  {
    description: 'glTF Model',
    accept: {
      'model/gltf+json': ['.gltf'],
      'model/gltf-binary': ['.glb'],
    },
  },
];

export const IMAGE_FILES: FileDialogType[] = [
  {
    description: 'Texture Image',
    accept: {
      'image/png': ['.png'],
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/webp': ['.webp'],
      'image/gif': ['.gif'],
      'image/bmp': ['.bmp'],
    },
  },
];
