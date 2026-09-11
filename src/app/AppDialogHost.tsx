import { useEffect, useRef, useState } from 'react';
import { BlenderIcon } from '@/components/BlenderIcon';
import {
  subscribeAppDialogs,
  type AppDialogRequest,
} from '@/app/platform/appDialogs';

export function AppDialogHost() {
  const [request, setRequest] = useState<AppDialogRequest | null>(null);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => subscribeAppDialogs(setRequest), []);

  useEffect(() => {
    if (!request) return;
    if (request.kind === 'prompt') {
      setDraft(request.options.value ?? '');
      window.setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 0);
      return;
    }
    window.setTimeout(() => {
      (request.options.danger ? cancelRef.current : confirmRef.current)?.focus();
    }, 0);
  }, [request]);

  useEffect(() => {
    if (!request) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (request.kind === 'confirm') request.resolve(false);
        else request.resolve(null);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [request]);

  if (!request) return null;

  const submitPrompt = () => {
    if (request.kind !== 'prompt') return;
    const next = draft.trim();
    request.resolve(next ? next : null);
  };

  return (
    <div
      className="app-modal-backdrop app-dialog-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        if (request.kind === 'confirm') request.resolve(false);
        else request.resolve(null);
      }}
    >
      <div
        className="app-modal app-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-dialog-title"
        data-block-shortcuts="true"
      >
        <div className="app-modal-header">
          <div className="app-dialog-title-row">
            <BlenderIcon
              name={request.kind === 'prompt' ? 'file_new' : request.options.danger ? 'error' : 'info'}
              size={16}
            />
            <h2 id="app-dialog-title">{request.options.title}</h2>
          </div>
        </div>
        {request.options.message ? <p>{request.options.message}</p> : null}
        {request.kind === 'prompt' ? (
          <input
            ref={inputRef}
            className="app-dialog-input"
            value={draft}
            aria-label={request.options.title}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                submitPrompt();
              }
            }}
          />
        ) : null}
        <div className="app-modal-actions">
          <button
            ref={cancelRef}
            type="button"
            className="tool"
            onClick={() => {
              if (request.kind === 'confirm') request.resolve(false);
              else request.resolve(null);
            }}
          >
            {request.options.cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={`tool primary${request.kind === 'confirm' && request.options.danger ? ' danger' : ''}`}
            onClick={() => {
              if (request.kind === 'confirm') request.resolve(true);
              else submitPrompt();
            }}
          >
            {request.options.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
