import { useState, useEffect, useRef } from 'react';
import styles from './BotLogPanel.module.css';

interface LogEntry {
  message: string;
  timestamp: string;
  type: 'bot' | 'user';
}

interface Props {
  logs: LogEntry[];
  onSendMessage: (message: string) => void;
}

export default function BotLogPanel({ logs, onSendMessage }: Props) {
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
            {logs.map((log, i) => (
              <div
                key={i}
                className={`${styles.logEntry} ${log.type === 'user' ? styles.userEntry : styles.botEntry}`}
              >
                <span className={styles.logTime}>
                  {new Date(log.timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
                <span className={styles.logLabel}>
                  {log.type === 'user' ? 'Vous' : 'Bot'}
                </span>
                <span className={styles.logMessage}>{log.message}</span>
              </div>
            ))}
          </div>

          <div className={styles.inputArea}>
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
