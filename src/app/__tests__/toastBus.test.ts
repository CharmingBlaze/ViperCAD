import { describe, expect, it } from 'vitest';
import { pushToast, subscribeToasts } from '@/app/toastBus';

describe('toastBus', () => {
  it('delivers toasts to subscribers and stops after unsubscribe', () => {
    const received: string[] = [];
    const unsubscribe = subscribeToasts((toast) => received.push(`${toast.kind}:${toast.text}`));
    pushToast('saved', 'success');
    expect(received).toEqual(['success:saved']);
    unsubscribe();
    pushToast('ignored');
    expect(received).toEqual(['success:saved']);
  });
});
