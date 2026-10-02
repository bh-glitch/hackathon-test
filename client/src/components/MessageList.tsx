import { useEffect, useRef } from 'react';
import type { MessageListProps } from '../../../shared/components';

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
});

function formatTime(timestamp: string) {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? '' : timeFormatter.format(date);
}

export function MessageList({ messages, currentUserId, loading, error }: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const scrollArea = scrollRef.current;
    if (scrollArea) scrollArea.scrollTop = scrollArea.scrollHeight;
  }, [messages.length]);

  return (
    <div className="message-panel" aria-busy={loading}>
      <div className="message-panel__header">
        <div>
          <p className="eyebrow">Room conversation</p>
          <h2>Messages</h2>
        </div>
        {!loading && messages.length > 0 && (
          <span className="message-count" aria-label={`${messages.length} messages`}>
            {messages.length}
          </span>
        )}
      </div>

      <div ref={scrollRef} className="message-scroll" aria-live="polite" aria-relevant="additions text">
        {loading && (
          <div className="state-card state-card--loading" role="status">
            <span className="spinner" aria-hidden="true" />
            <div>
              <strong>Loading conversation</strong>
              <p>Fetching room history…</p>
            </div>
          </div>
        )}

        {!loading && error && (
          <div className="state-card state-card--error" role="alert">
            <span className="state-card__icon" aria-hidden="true">!</span>
            <div>
              <strong>Messages could not be loaded</strong>
              <p>{error}</p>
            </div>
          </div>
        )}

        {!loading && !error && messages.length === 0 && (
          <div className="empty-state">
            <span className="empty-state__icon" aria-hidden="true">✦</span>
            <h3>Start the conversation</h3>
            <p>Send the first message to get this study room going.</p>
          </div>
        )}

        {!loading && messages.map((message) => {
          const ownMessage = message.senderId === currentUserId;
          const timestamp = formatTime(message.createdAt);

          return (
            <article
              className={`message ${ownMessage ? 'message--own' : ''}`}
              key={message.id}
              aria-label={`Message from ${ownMessage ? 'you' : message.senderName}`}
            >
              <div className="message__meta">
                <span className="message__sender">{ownMessage ? 'You' : message.senderName}</span>
                {timestamp && <time dateTime={message.createdAt}>{timestamp}</time>}
              </div>
              <p className="message__bubble">{message.text}</p>
            </article>
          );
        })}
      </div>
    </div>
  );
}
