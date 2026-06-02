import { useState, useEffect, useRef } from 'react';
import styles from './BotLogPanel.module.css';

interface LogEntry {
  message: string;
  timestamp: string;
  type: 'bot' | 'user' | 'advisor';
}

interface Props {
  logs: LogEntry[];
  onSendMessage: (message: string) => void;
  onAskAdvisor?: () => void;
}

export default function BotLogPanel({ logs, onSendMessage, onAskAdvisor }: Props) {
  const [isOpen, setIsOpen] = useState(true);
  const [input, setInput] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [logs]);

  const handleSend = () => {
    if (!input.trim()) return;
    onSendMessage(input.trim());
    setInput('');
  };

  const renderMessage = (msg: string) => {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const parts = msg.split(urlRegex);
    return parts.map((part, idx) =>
      urlRegex.test(part) ? (
        <a key={idx} href={part} target="_blank" rel="noopener noreferrer" className={styles.logLink}>
          {part.length > 60 ? part.slice(0, 57) + '...' : part}
        </a>
      ) : (
        <span key={idx}>{part}</span>
      )
    );
  };

  return (
    <div className={`${styles.panel} ${isOpen ? styles.open : styles.closed}`}>
      <button className={styles.toggle} onClick={() => setIsOpen(!isOpen)}>
        <span className={styles.toggleIcon}>{isOpen ? '▼' : '▲'}</span>
        Bot Log
        {!isOpen && logs.length > 0 && (
          <span className={styles.badge}>{logs.length}</span>
        )}
      </button>

      {isOpen && (
        <>
          <div ref={listRef} className={styles.logList}>
            {logs.length === 0 && (
              <div className={styles.empty}>En attente d'activité...</div>
            )}
            {logs.map((log, i) => {
              const entryClass =
                log.type === 'user'
                  ? styles.userEntry
                  : log.type === 'advisor'
                    ? styles.advisorEntry
                    : styles.botEntry;
              const label =
                log.type === 'user' ? 'Vous' : log.type === 'advisor' ? '🧙 Advisor' : 'Bot';
              return (
                <div key={i} className={`${styles.logEntry} ${entryClass}`}>
                  <span className={styles.logTime}>
                    {new Date(log.timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                  <span className={styles.logLabel}>{label}</span>
                  <span className={styles.logMessage}>{renderMessage(log.message)}</span>
                </div>
              );
            })}
          </div>

          <div className={styles.inputArea}>
            {onAskAdvisor && (
              <button
                className={styles.advisorBtn}
                onClick={onAskAdvisor}
                title="Demander une suggestion à l'Advisor"
              >
                🧙
              </button>
            )}
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              placeholder="Instruction au bot..."
              className={styles.input}
            />
            <button className={styles.sendBtn} onClick={handleSend}>
              ➤
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export type { LogEntry };
