import type { Participant } from '@boardbot/shared';
import styles from './ParticipantList.module.css';

interface Props {
  participants: Participant[];
}

export default function ParticipantList({ participants }: Props) {
  if (participants.length === 0) {
    return (
      <div className={styles.empty}>
        Aucun participant configuré
      </div>
    );
  }

  return (
    <div className={styles.list}>
      <h3 className={styles.title}>Participants</h3>
      {participants.map((p) => (
        <div key={p.participant_id} className={styles.item}>
          <div className={styles.avatar} style={{ background: p.color }}>
            {p.avatar_initials}
          </div>
          <div className={styles.info}>
            <span className={styles.name}>{p.display_name}</span>
            <span className={styles.speaker}>{p.speaker_label}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
