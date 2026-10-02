import { useState } from 'react';
import type { ParticipantSidebarProps } from '../../../shared/components';
import type { ConnectionStatus } from '../../../shared/types';

const statusCopy: Record<ConnectionStatus, { label: string; detail: string }> = {
  idle: { label: 'Not connected', detail: 'Join the room to connect' },
  connecting: { label: 'Connecting', detail: 'Opening a live connection' },
  joined: { label: 'Connected', detail: 'Messages update live' },
  reconnecting: { label: 'Reconnecting', detail: 'Trying to restore your session' },
  error: { label: 'Connection lost', detail: 'Unable to reach the room' },
};

export function ParticipantSidebar({ participants, currentUserId, status }: ParticipantSidebarProps) {
  const [isOpen, setIsOpen] = useState(false);
  const onlineCount = participants.filter((participant) => participant.online).length;
  const connection = statusCopy[status];
  const sortedParticipants = [...participants].sort((left, right) => {
    if (left.online !== right.online) return left.online ? -1 : 1;
    return left.displayName.localeCompare(right.displayName);
  });

  return (
    <aside className={`participant-sidebar ${isOpen ? 'participant-sidebar--open' : 'participant-sidebar--collapsed'}`} aria-label="Room participants">
      <button
        className="participant-sidebar__toggle"
        type="button"
        aria-expanded={isOpen}
        aria-controls="participant-dropdown"
        onClick={() => setIsOpen((open) => !open)}
      >
        <div>
          <p className="eyebrow">Study group</p>
          <h2>Participants</h2>
          <span className="participant-toggle__summary">{onlineCount} online</span>
        </div>
        <span className="participant-toggle__actions">
          <span className={`connection-dot connection-dot--${status}`} aria-hidden="true" />
          <span className="participant-total">{participants.length}</span>
          <svg className="participant-chevron" viewBox="0 0 20 20" aria-hidden="true">
            <path d="m5 7.5 5 5 5-5" />
          </svg>
        </span>
      </button>

      <div className="participant-dropdown" id="participant-dropdown" aria-hidden={!isOpen}>
        <div className="participant-dropdown__inner">
          <p className="participant-summary">{onlineCount} online · {participants.length - onlineCount} offline</p>

          <ul className="participant-list">
            {sortedParticipants.map((participant) => {
              const isCurrentUser = participant.userId === currentUserId;
              return (
                <li key={participant.userId} className={!participant.online ? 'participant participant--offline' : 'participant'}>
                  <span className="avatar" aria-hidden="true">{participant.displayName.trim().charAt(0).toUpperCase() || '?'}</span>
                  <span className="participant__identity">
                    <span className="participant__name">
                      {participant.displayName}{isCurrentUser && <span className="you-label">You</span>}
                    </span>
                    <span className="participant__presence">
                      <span className={`presence-dot ${participant.online ? 'presence-dot--online' : ''}`} aria-hidden="true" />
                      {participant.online ? 'Online' : 'Offline'}
                    </span>
                  </span>
                </li>
              );
            })}

            {participants.length === 0 && (
              <li className="participant-list__empty">Participants will appear here after they join.</li>
            )}
          </ul>

          <div className={`connection-card connection-card--${status}`} role="status" aria-live="polite">
            <span className="connection-card__indicator" aria-hidden="true" />
            <span>
              <strong>{connection.label}</strong>
              <small>{connection.detail}</small>
            </span>
          </div>
        </div>
      </div>
    </aside>
  );
}
