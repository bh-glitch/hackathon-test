import type { MessageListProps } from '../../../shared/components';
export function MessageList(props: MessageListProps) {
  return <div aria-live="polite"><p>Message list placeholder ({props.messages.length} messages).</p>{props.loading && <p>Loading…</p>}{props.error && <p role="alert">{props.error}</p>}</div>;
}
