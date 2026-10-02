import type { MessageComposerProps } from '../../../shared/components';
export function MessageComposer(props: MessageComposerProps) {
  return <div><label htmlFor="message-draft">Message</label><textarea id="message-draft" value={props.value} onChange={(event) => props.onChange(event.target.value)} disabled={props.disabled || props.sending} /><button disabled={props.disabled || props.sending} onClick={props.onSend}>Send</button>{props.error && <p role="alert">{props.error}</p>}</div>;
}
