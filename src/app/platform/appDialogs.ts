export type ConfirmDialogOptions = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};

export type PromptDialogOptions = {
  title: string;
  message?: string;
  value?: string;
  confirmLabel?: string;
  cancelLabel?: string;
};

export type AppDialogRequest =
  | {
      id: number;
      kind: 'confirm';
      options: Required<Pick<ConfirmDialogOptions, 'confirmLabel' | 'cancelLabel'>> & ConfirmDialogOptions;
      resolve: (ok: boolean) => void;
    }
  | {
      id: number;
      kind: 'prompt';
      options: Required<Pick<PromptDialogOptions, 'confirmLabel' | 'cancelLabel'>> & PromptDialogOptions;
      resolve: (value: string | null) => void;
    };

type Listener = (request: AppDialogRequest | null) => void;

let nextId = 1;
let current: AppDialogRequest | null = null;
const queue: AppDialogRequest[] = [];
const listeners = new Set<Listener>();

function publish(): void {
  for (const listener of listeners) listener(current);
}

function presentNext(): void {
  current = queue.shift() ?? null;
  publish();
}

function settle<T>(id: number, resolve: (value: T) => void): (value: T) => void {
  let done = false;
  return (value) => {
    if (done) return;
    done = true;
    if (current?.id === id) current = null;
    resolve(value);
    presentNext();
  };
}

export function isAppDialogOpen(): boolean {
  return current !== null;
}

export function subscribeAppDialogs(listener: Listener): () => void {
  listeners.add(listener);
  listener(current);
  return () => {
    listeners.delete(listener);
  };
}

export function confirmAction(options: ConfirmDialogOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const id = nextId++;
    const request: AppDialogRequest = {
      id,
      kind: 'confirm',
      options: {
        confirmLabel: 'OK',
        cancelLabel: 'Cancel',
        ...options,
      },
      resolve: settle(id, resolve),
    };
    if (current) queue.push(request);
    else {
      current = request;
      publish();
    }
  });
}

export function promptText(options: PromptDialogOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const id = nextId++;
    const request: AppDialogRequest = {
      id,
      kind: 'prompt',
      options: {
        confirmLabel: 'OK',
        cancelLabel: 'Cancel',
        ...options,
      },
      resolve: settle(id, resolve),
    };
    if (current) queue.push(request);
    else {
      current = request;
      publish();
    }
  });
}
