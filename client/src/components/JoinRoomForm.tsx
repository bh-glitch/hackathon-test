import type { FormEvent } from 'react';
import type { JoinRoomFormProps } from '../../../shared/components';
import { PROPOSED_MAX_DISPLAY_NAME_LENGTH } from '../../../shared/types';

export function JoinRoomForm({ displayName, onDisplayNameChange, onJoin, joining, error }: JoinRoomFormProps) {
  const trimmedLength = displayName.trim().length;
  const empty = trimmedLength === 0;
  const tooLong = trimmedLength > PROPOSED_MAX_DISPLAY_NAME_LENGTH;
  const validationMessage = tooLong
    ? `Use ${PROPOSED_MAX_DISPLAY_NAME_LENGTH} characters or fewer.`
    : null;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!joining && !empty && !tooLong) onJoin();
  };

  return (
    <section className="join-card" aria-labelledby="join-heading">
      <div className="join-card__mark" aria-hidden="true">SR</div>
      <div className="join-card__copy">
        <p className="eyebrow">You’ve been invited</p>
        <h2 id="join-heading">Join the study room</h2>
        <p>Choose the name your classmates will see.</p>
      </div>

      <form className="join-form" onSubmit={submit}>
        <label htmlFor="display-name">Display name</label>
        <div className="join-form__controls">
          <input
            id="display-name"
            value={displayName}
            onChange={(event) => onDisplayNameChange(event.target.value)}
            disabled={joining}
            maxLength={PROPOSED_MAX_DISPLAY_NAME_LENGTH + 20}
            autoComplete="nickname"
            autoFocus
            placeholder="e.g. Ishan"
            aria-describedby="display-name-help"
            aria-invalid={Boolean(error) || tooLong}
          />
          <button type="submit" disabled={joining || empty || tooLong}>
            {joining && <span className="spinner spinner--small" aria-hidden="true" />}
            {joining ? 'Joining…' : 'Join room'}
          </button>
        </div>
        <div id="display-name-help">
          {(validationMessage || error) ? (
            <p className="inline-error" role="alert">{validationMessage ?? error}</p>
          ) : (
            <p className="field-help">1–{PROPOSED_MAX_DISPLAY_NAME_LENGTH} characters after trimming spaces.</p>
          )}
        </div>
      </form>
    </section>
  );
}
