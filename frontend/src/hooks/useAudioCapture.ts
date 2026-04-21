import { useState, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

const TARGET_SAMPLE_RATE = 16000;

function downsample(inputBuffer: Float32Array, inputRate: number, outputRate: number): Int16Array {
  if (inputRate === outputRate) {
    const pcm16 = new Int16Array(inputBuffer.length);
    for (let i = 0; i < inputBuffer.length; i++) {
      const s = Math.max(-1, Math.min(1, inputBuffer[i]));
      pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return pcm16;
  }

  const ratio = inputRate / outputRate;
  const outputLength = Math.floor(inputBuffer.length / ratio);
  const pcm16 = new Int16Array(outputLength);

  for (let i = 0; i < outputLength; i++) {
    const idx = Math.floor(i * ratio);
    const s = Math.max(-1, Math.min(1, inputBuffer[idx]));
    pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }

  return pcm16;
}

function setupAudioPipeline(
  stream: MediaStream,
  sessionId: string,
  socketRef: React.MutableRefObject<Socket | null>,
  contextRef: React.MutableRefObject<AudioContext | null>,
  processorRef: React.MutableRefObject<ScriptProcessorNode | null>
) {
  const audioSocket = io(window.location.origin, {
    transports: ['polling', 'websocket'],
  });

  audioSocket.on('connect', () => {
    console.log('[Audio] Socket connected');
    audioSocket.emit('audio:start', { session_id: sessionId });
  });

  socketRef.current = audioSocket;

  const audioContext = new AudioContext();
  contextRef.current = audioContext;

  const actualSampleRate = audioContext.sampleRate;
  console.log(`[Audio] Sample rate: ${actualSampleRate} → ${TARGET_SAMPLE_RATE}`);

  const source = audioContext.createMediaStreamSource(stream);
  const processor = audioContext.createScriptProcessor(4096, 1, 1);
  processorRef.current = processor;

  let chunkCount = 0;
  processor.onaudioprocess = (event) => {
    if (!socketRef.current?.connected) return;
    const inputData = event.inputBuffer.getChannelData(0);

    // Every ~1s, log the RMS level so we can verify the mic is actually picking up sound.
    // Healthy speech ~ 0.05–0.3; near 0 = mic silent or muted.
    if (++chunkCount % 10 === 0) {
      let sum = 0;
      for (let i = 0; i < inputData.length; i++) sum += inputData[i] * inputData[i];
      const rms = Math.sqrt(sum / inputData.length);
      console.log(`[Audio] RMS=${rms.toFixed(4)} sampleRate=${actualSampleRate}`);
    }

    const pcm16 = downsample(inputData, actualSampleRate, TARGET_SAMPLE_RATE);
    socketRef.current.emit('audio:chunk', pcm16.buffer);
  };

  source.connect(processor);
  processor.connect(audioContext.destination);
}

export function useAudioCapture(sessionId: string | undefined) {
  const [isRecording, setIsRecording] = useState(false);
  const [isCapturingTab, setIsCapturingTab] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const audioSocketRef = useRef<Socket | null>(null);

  // Option 1: Micro local (capture uniquement toi)
  const startRecording = useCallback(async () => {
    if (!sessionId) return;
    setError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        // noiseSuppression + aggressive AGC can literally silence speech on laptop mics.
        // Keep echo cancellation (useful for meetings), drop noise suppression.
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: false, autoGainControl: true },
      });
      streamRef.current = stream;
      setupAudioPipeline(stream, sessionId, audioSocketRef, audioContextRef, processorRef);
      setIsRecording(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible d'accéder au microphone");
    }
  }, [sessionId]);

  // Option 2: Capture audio d'un onglet (capture tout le monde dans le call)
  const startTabCapture = useCallback(async () => {
    if (!sessionId) return;
    setError(null);

    try {
      // getDisplayMedia avec audio capture le son de l'onglet/écran partagé
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true, // required by the API but we don't use it
        audio: true, // this captures the tab/system audio
      });

      // On n'a besoin que de l'audio — on peut arrêter les tracks vidéo
      stream.getVideoTracks().forEach((track) => track.stop());

      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0) {
        setError("Pas d'audio dans le partage. Assurez-vous de cocher 'Partager l'audio' dans la popup.");
        return;
      }

      // Créer un nouveau stream audio only
      const audioStream = new MediaStream(audioTracks);
      streamRef.current = audioStream;

      setupAudioPipeline(audioStream, sessionId, audioSocketRef, audioContextRef, processorRef);
      setIsCapturingTab(true);

      // Detect when user stops sharing
      audioTracks[0].onended = () => {
        stopRecording();
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de capturer l'audio de l'onglet");
    }
  }, [sessionId]);

  const stopRecording = useCallback(() => {
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (audioSocketRef.current) {
      audioSocketRef.current.emit('audio:stop');
      audioSocketRef.current.disconnect();
      audioSocketRef.current = null;
    }
    setIsRecording(false);
    setIsCapturingTab(false);
  }, []);

  return {
    isRecording,
    isCapturingTab,
    isActive: isRecording || isCapturingTab,
    error,
    startRecording,
    startTabCapture,
    stopRecording,
  };
}
