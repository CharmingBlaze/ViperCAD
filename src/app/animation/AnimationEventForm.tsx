import { useEffect, useState } from 'react';

type Props = {
  defaultName?: string;
  defaultParameter?: string;
  submitLabel: string;
  onSubmit: (name: string, parameter?: string) => void;
  onDelete?: () => void;
};

export function AnimationEventForm({
  defaultName = 'Footstep.Left',
  defaultParameter = '',
  submitLabel,
  onSubmit,
  onDelete,
}: Props) {
  const [name, setName] = useState(defaultName);
  const [parameter, setParameter] = useState(defaultParameter);

  useEffect(() => {
    setName(defaultName);
    setParameter(defaultParameter);
  }, [defaultName, defaultParameter]);

  return (
    <form
      className="anim-event-form"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = name.trim();
        if (!trimmed) return;
        onSubmit(trimmed, parameter.trim() || undefined);
      }}
    >
      <label className="rig-field">
        <span>Name</span>
        <input
          className="rig-input"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Footstep.Left"
        />
      </label>
      <label className="rig-field">
        <span>Parameter</span>
        <input
          className="rig-input"
          value={parameter}
          onChange={(event) => setParameter(event.target.value)}
          placeholder="optional payload"
        />
      </label>
      <div className="rig-btn-row">
        <button type="submit" className="rig-btn rig-btn-primary">
          {submitLabel}
        </button>
        {onDelete && (
          <button type="button" className="rig-btn" onClick={onDelete}>
            Delete
          </button>
        )}
      </div>
    </form>
  );
}
