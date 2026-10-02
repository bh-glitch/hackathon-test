import type { ParticipantSidebarProps } from '../../../shared/components';
export function ParticipantSidebar(props: ParticipantSidebarProps) {
  return <aside aria-label="Participants"><h2>Participants</h2><p>Sidebar placeholder ({props.participants.length} members).</p><p>Connection: {props.status}</p></aside>;
}
