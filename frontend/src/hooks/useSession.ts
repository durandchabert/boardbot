import { useState, useEffect, useCallback } from 'react';
import type { MeetingSession } from '@boardbot/shared';

const API = '/api';

export function useSession(sessionId: string | undefined) {
  const [session, setSession] = useState<MeetingSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSession = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    try {
      const res = await fetch(`${API}/sessions/${sessionId}`);
      if (!res.ok) throw new Error('Session not found');
      const data = await res.json();
      setSession(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    fetchSession();
  }, [fetchSession]);

  const addParticipant = useCallback(
    async (displayName: string, speakerLabel: string) => {
      if (!sessionId) return;
      const res = await fetch(`${API}/sessions/${sessionId}/participants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_name: displayName, speaker_label: speakerLabel }),
      });
      if (!res.ok) throw new Error('Failed to add participant');
      await fetchSession();
    },
    [sessionId, fetchSession]
  );

  return { session, loading, error, refetch: fetchSession, addParticipant };
}

export async function createSession(title: string): Promise<MeetingSession> {
  const res = await fetch(`${API}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error('Failed to create session');
  return res.json();
}
