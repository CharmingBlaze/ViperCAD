import { describe, expect, it } from 'vitest';
import {
  confirmAction,
  isAppDialogOpen,
  promptText,
  subscribeAppDialogs,
} from '@/app/platform/appDialogs';

describe('app dialogs', () => {
  it('opens a confirm and resolves through the host', async () => {
    let seen = false;
    const stop = subscribeAppDialogs((request) => {
      if (request?.kind === 'confirm' && !seen) {
        seen = true;
        expect(isAppDialogOpen()).toBe(true);
        expect(request.options.title).toBe('Unsaved changes');
        request.resolve(true);
      }
    });
    await expect(
      confirmAction({
        title: 'Unsaved changes',
        message: 'Discard them?',
        confirmLabel: 'Discard',
        danger: true,
      }),
    ).resolves.toBe(true);
    expect(isAppDialogOpen()).toBe(false);
    stop();
  });

  it('returns typed prompt text', async () => {
    const stop = subscribeAppDialogs((request) => {
      if (request?.kind === 'prompt') request.resolve('Hall');
    });
    await expect(
      promptText({
        title: 'Rename',
        value: 'Untitled',
        confirmLabel: 'Rename',
      }),
    ).resolves.toBe('Hall');
    stop();
  });
});
