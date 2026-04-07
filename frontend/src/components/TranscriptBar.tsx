import { useMemo } from 'react';
import type { Participant } from '@boardbot/shared';
import styles from './TranscriptBar.module.css';

interface Props {
  transcript: { speaker_label: string; text: string; is_final: boolean } | null;
  participants: Participant[];
}

export default function TranscriptBar({ transcript, participants }: Props) {
  const speakerMap = useMemo(() => {
    const map = new Map<string, Participant>();
    for (const p of participants) {
      map.set(p.speaker_label, p);
    }
    return map;
  }, [participants]);

  if (!transcript) {
    return (
      <div className={styles.bar}>
        <span className={styles.placeholder}>
          En attente de transcription...
        </span>
      </div>
    );
  }

  const speaker = speakerMap.get(transcript.speaker_label);

  return (
    <div className={styles.bar}>
      {speaker && (
        <div
          className={styles.avatar}
          style={{ background: speaker.color }}
        >
          {speaker.avatar_initials}
        </div>
      )}
      <span className={styles.speakerName}>
        {speaker?.display_name ?? transcript.speaker_label}
      </span>
      <span className={`${styles.text} ${transcript.is_final ? styles.final : styles.interim}`}>
        {transcript.text}
      </span>
    </div>
  );
}
