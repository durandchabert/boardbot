import type { Browser, Page } from 'puppeteer';
import { getDeepgramService } from './deepgramService.js';
import { getSocketService } from './socketService.js';

async function launchPuppeteer() {
  const puppeteer = await import('puppeteer');
  return puppeteer.default;
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

interface BotInstance {
  browser: Browser;
  page: Page;
  sessionId: string;
  meetingUrl: string;
  status: 'joining' | 'connected' | 'error' | 'stopped';
  audioStream: unknown;
}

const activeBots = new Map<string, BotInstance>();

export function getBotStatus(sessionId: string): BotInstance | null {
  return activeBots.get(sessionId) ?? null;
}

export async function startMeetingBot(
  sessionId: string,
  meetingUrl: string,
  botName: string = 'BoardBot',
  language: string = 'fr'
): Promise<{ ok: boolean; error?: string }> {
  if (activeBots.has(sessionId)) {
    return { ok: false, error: 'Bot already running for this session' };
  }

  const socketService = getSocketService();

  try {
    socketService?.emitBotLog(sessionId, `Lancement du bot pour rejoindre ${meetingUrl.slice(0, 50)}...`);

    // Launch browser with audio capture enabled
    const puppeteer = await launchPuppeteer();
    const browser = await puppeteer.launch({
      headless: false, // Need visible browser for Meet/Teams
      args: [
        '--use-fake-ui-for-media-stream', // Auto-accept mic/cam permissions
        '--use-fake-device-for-media-stream', // Fake devices
        '--disable-web-security',
        '--auto-select-desktop-capture-source=Entire screen',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-infobars',
        '--window-size=1280,720',
        // Enable audio capture
        '--enable-usermedia-screen-capturing',
        '--allow-http-screen-capture',
        '--autoplay-policy=no-user-gesture-required',
      ],
      defaultViewport: { width: 1280, height: 720 },
    });

    const page = await browser.newPage();

    const bot: BotInstance = {
      browser,
      page,
      sessionId,
      meetingUrl,
      status: 'joining',
      audioStream: null,
    };
    activeBots.set(sessionId, bot);

    // Determine meeting type and join
    if (meetingUrl.includes('meet.google.com')) {
      await joinGoogleMeet(bot, botName);
    } else if (meetingUrl.includes('teams.microsoft.com') || meetingUrl.includes('teams.live.com')) {
      await joinTeams(bot, botName);
    } else {
      // Generic: just navigate to the URL
      await page.goto(meetingUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      socketService?.emitBotLog(sessionId, `Navigué vers ${meetingUrl}`);
    }

    bot.status = 'connected';
    socketService?.emitBotLog(sessionId, `Bot connecté au meeting`);

    // Start capturing audio from the page via the Web Audio API
    await startAudioCapture(bot, language);

    return { ok: true };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[MeetingBot] Error:', errorMsg);
    socketService?.emitBotLog(sessionId, `Erreur bot : ${errorMsg}`);

    // Cleanup on error
    const bot = activeBots.get(sessionId);
    if (bot) {
      await bot.browser.close().catch(() => {});
      activeBots.delete(sessionId);
    }

    return { ok: false, error: errorMsg };
  }
}

async function joinGoogleMeet(bot: BotInstance, botName: string): Promise<void> {
  const { page, sessionId } = bot;
  const socketService = getSocketService();

  socketService?.emitBotLog(sessionId, `Navigation vers Google Meet...`);
  await page.goto(bot.meetingUrl, { waitUntil: 'networkidle2', timeout: 30000 });

  // Wait a moment for the page to load
  await wait(3000);

  // Try to set the display name if there's a name input
  try {
    const nameInput = await page.$('input[aria-label="Your name"]');
    if (nameInput) {
      await nameInput.click({ clickCount: 3 });
      await nameInput.type(botName);
      socketService?.emitBotLog(sessionId, `Nom défini : ${botName}`);
    }
  } catch {
    // Name input might not be available
  }

  // Turn off camera and microphone before joining
  try {
    // Camera toggle (usually the first toggle)
    const cameraBtn = await page.$('[data-is-muted][aria-label*="camera" i], [aria-label*="caméra" i]');
    if (cameraBtn) await cameraBtn.click();

    // Mic toggle
    const micBtn = await page.$('[data-is-muted][aria-label*="microphone" i], [aria-label*="micro" i]');
    if (micBtn) await micBtn.click();
  } catch {
    // Toggles might have different selectors
  }

  await wait(1000);

  // Click "Join now" / "Participer" button
  try {
    const joinSelectors = [
      'button[jsname="Qx7uuf"]', // Common "Join now" button
      '[data-idom-class*="join"]',
      'button:has-text("Join now")',
      'button:has-text("Participer")',
      'button:has-text("Rejoindre")',
      'button:has-text("Ask to join")',
      'button:has-text("Demander à participer")',
    ];

    for (const selector of joinSelectors) {
      try {
        const btn = await page.$(selector);
        if (btn) {
          await btn.click();
          socketService?.emitBotLog(sessionId, `Bouton "Rejoindre" cliqué`);
          break;
        }
      } catch {
        continue;
      }
    }

    // Fallback: click any button containing join-related text
    await page.evaluate(() => {
      const buttons = document.querySelectorAll('button');
      for (const btn of buttons) {
        const text = btn.textContent?.toLowerCase() ?? '';
        if (text.includes('join') || text.includes('participer') || text.includes('rejoindre') || text.includes('ask to join')) {
          btn.click();
          break;
        }
      }
    });
  } catch {
    socketService?.emitBotLog(sessionId, `Pas trouvé le bouton rejoindre — essayez manuellement dans la fenêtre`);
  }

  // Wait for the meeting to actually start
  await wait(5000);
  socketService?.emitBotLog(sessionId, `Dans le meeting Google Meet`);
}

async function joinTeams(bot: BotInstance, botName: string): Promise<void> {
  const { page, sessionId } = bot;
  const socketService = getSocketService();

  socketService?.emitBotLog(sessionId, `Navigation vers Teams...`);
  await page.goto(bot.meetingUrl, { waitUntil: 'networkidle2', timeout: 30000 });

  await wait(3000);

  // Try "Continue on this browser" button
  try {
    await page.evaluate(() => {
      const links = document.querySelectorAll('a, button');
      for (const el of links) {
        const text = el.textContent?.toLowerCase() ?? '';
        if (text.includes('continue on this browser') || text.includes('continuer sur ce navigateur') || text.includes('use web app')) {
          (el as HTMLElement).click();
          break;
        }
      }
    });
    await wait(3000);
  } catch {
    // Might already be in browser mode
  }

  // Enter name
  try {
    const nameInput = await page.$('input[placeholder*="name" i], input[placeholder*="nom" i]');
    if (nameInput) {
      await nameInput.click({ clickCount: 3 });
      await nameInput.type(botName);
    }
  } catch {
    // No name field
  }

  // Turn off camera and mic
  try {
    await page.evaluate(() => {
      const toggles = document.querySelectorAll('[aria-label*="camera" i], [aria-label*="micro" i], [aria-label*="caméra" i]');
      toggles.forEach(t => (t as HTMLElement).click());
    });
  } catch {
    // Toggles not found
  }

  await wait(1000);

  // Click "Join now"
  try {
    await page.evaluate(() => {
      const buttons = document.querySelectorAll('button');
      for (const btn of buttons) {
        const text = btn.textContent?.toLowerCase() ?? '';
        if (text.includes('join now') || text.includes('rejoindre') || text.includes('participer')) {
          btn.click();
          break;
        }
      }
    });
  } catch {
    socketService?.emitBotLog(sessionId, `Pas trouvé le bouton rejoindre Teams`);
  }

  await wait(5000);
  socketService?.emitBotLog(sessionId, `Dans le meeting Teams`);
}

async function startAudioCapture(bot: BotInstance, language: string = 'fr'): Promise<void> {
  const { page, sessionId } = bot;
  const socketService = getSocketService();

  socketService?.emitBotLog(sessionId, `Démarrage de la capture audio...`);

  // Inject audio capture script into the page
  // This captures all audio output from the page using AudioContext
  await page.evaluate(() => {
    (window as unknown as Record<string, unknown>).__boardbot_audio_chunks = [];

    const audioContext = new AudioContext({ sampleRate: 16000 });

    // Capture audio from the page's audio elements
    const captureAudio = () => {
      const audioElements = document.querySelectorAll('audio, video');
      audioElements.forEach((el) => {
        try {
          const source = audioContext.createMediaElementSource(el as HTMLMediaElement);
          const processor = audioContext.createScriptProcessor(4096, 1, 1);

          processor.onaudioprocess = (event) => {
            const inputData = event.inputBuffer.getChannelData(0);
            const pcm16 = new Int16Array(inputData.length);
            for (let i = 0; i < inputData.length; i++) {
              const s = Math.max(-1, Math.min(1, inputData[i]));
              pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
            }
            ((window as unknown as Record<string, unknown>).__boardbot_audio_chunks as ArrayBuffer[]).push(pcm16.buffer);
          };

          source.connect(processor);
          processor.connect(audioContext.destination);
        } catch {
          // Element already captured or CORS issue
        }
      });
    };

    // Watch for new audio/video elements
    const observer = new MutationObserver(() => captureAudio());
    observer.observe(document.body, { childList: true, subtree: true });

    // Initial capture
    captureAudio();

    // Also try to capture via getDisplayMedia or getUserMedia if available
    if (navigator.mediaDevices) {
      navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
        const source = audioContext.createMediaStreamSource(stream);
        const processor = audioContext.createScriptProcessor(4096, 1, 1);

        processor.onaudioprocess = (event) => {
          const inputData = event.inputBuffer.getChannelData(0);
          const pcm16 = new Int16Array(inputData.length);
          for (let i = 0; i < inputData.length; i++) {
            const s = Math.max(-1, Math.min(1, inputData[i]));
            pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
          }
          ((window as unknown as Record<string, unknown>).__boardbot_audio_chunks as ArrayBuffer[]).push(pcm16.buffer);
        };

        source.connect(processor);
        processor.connect(audioContext.destination);
      }).catch(() => {});
    }
  });

  // Poll audio chunks from the page and send to Deepgram
  const deepgram = getDeepgramService();
  if (deepgram) {
    deepgram.startSession(sessionId, language);
  }

  const pollInterval = setInterval(async () => {
    if (!activeBots.has(sessionId)) {
      clearInterval(pollInterval);
      return;
    }

    try {
      const chunks = await page.evaluate(() => {
        const arr = (window as unknown as Record<string, unknown>).__boardbot_audio_chunks as ArrayBuffer[];
        const copy = [...arr];
        arr.length = 0; // Clear
        return copy.map(buf => Array.from(new Uint8Array(buf)));
      });

      if (chunks.length > 0 && deepgram) {
        for (const chunk of chunks) {
          const buffer = new Uint8Array(chunk).buffer;
          deepgram.sendAudioBuffer(sessionId, buffer);
        }
      }
    } catch {
      // Page might have navigated
    }
  }, 200); // Poll every 200ms

  bot.audioStream = null; // Using polling instead
  socketService?.emitBotLog(sessionId, `Capture audio active — écoute en cours`);
}

export async function stopMeetingBot(sessionId: string): Promise<void> {
  const bot = activeBots.get(sessionId);
  if (!bot) return;

  const socketService = getSocketService();
  socketService?.emitBotLog(sessionId, `Arrêt du bot...`);

  const deepgram = getDeepgramService();
  if (deepgram) {
    deepgram.stopSession(sessionId);
  }

  try {
    await bot.browser.close();
  } catch {
    // Browser might already be closed
  }

  activeBots.delete(sessionId);
  socketService?.emitBotLog(sessionId, `Bot arrêté`);
}
