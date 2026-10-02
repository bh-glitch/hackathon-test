import type { JoinRoomFormProps } from '../../../shared/components';
export function JoinRoomForm(props: JoinRoomFormProps) {
  return <form onSubmit={(event) => { event.preventDefault(); props.onJoin(); }}><label htmlFor="display-name">Display name</label><input id="display-name" value={props.displayName} onChange={(event) => props.onDisplayNameChange(event.target.value)} disabled={props.joining} /><button disabled={props.joining || Boolean(props.error)}>Join room</button>{props.error && <p role="alert">{props.error}</p>}</form>;
}
