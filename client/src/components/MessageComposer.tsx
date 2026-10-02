import type { FormEvent, KeyboardEvent } from 'react';
import type { MessageComposerProps } from '../../../shared/components';
import { MAX_MESSAGE_LENGTH } from '../../../shared/types';

export function MessageComposer({ value, onChange, onSend, disabled, sending, error }: MessageComposerProps) {
  const empty = value.trim().length === 0;
  const tooLong = value.length > MAX_MESSAGE_LENGTH;
  const unavailable = disabled || sending || empty || tooLong;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!unavailable) onSend();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (!unavailable) onSend();
    }
  };

  return (
    <form className="composer" onSubmit={submit}>
      <label className="sr-only" htmlFor="message-draft">Write a message</label>
      <div className={`composer__field ${error ? 'composer__field--error' : ''}`}>
        <textarea
          id="message-draft"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled || sending}
          rows={1}
          placeholder={disabled ? 'Connect to the room to send a message' : 'Write a message…'}
          aria-describedby={error ? 'send-error message-count' : 'message-count'}
          aria-invalid={Boolean(error) || tooLong}
        />
        <button className="send-button" type="submit" disabled={unavailable}>
          {sending ? <span className="spinner spinner--small" aria-hidden="true" /> : <span aria-hidden="true">↑</span>}
          <span>{sending ? 'Sending' : error ? 'Retry' : 'Send'}</span>
        </button>
      </div>

      <div className="composer__footer">
        <div>
          {error && <p className="inline-error" id="send-error" role="alert">{error} Your draft is still here.</p>}
          {!error && disabled && <p className="composer__hint">Sending is available once you’re connected.</p>}
          {!error && !disabled && <p className="composer__hint">Enter to send · Shift + Enter for a new line</p>}
        </div>
        <span className={tooLong ? 'character-count character-count--error' : 'character-count'} id="message-count">
          {value.length}/{MAX_MESSAGE_LENGTH}
        </span>
      </div>
    </form>
  );
}
