export interface SharedFileRef {
  path: string;
  name: string;
  mime: string;
}

export interface NativeSharePayload {
  id?: string;
  text?: string;
  files?: SharedFileRef[];
  receivedAt?: string;
  source?: string;
}

export interface SharedCapture {
  text?: string;
  files?: File[];
  receivedAt?: string;
  source?: string;
}

const KEY = 'aimarkdown.pending-shares';
const EVENT = 'aimarkdown:share-received';

function readQueue(): NativeSharePayload[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? (parsed as NativeSharePayload[]).slice(-20) : [];
  } catch {
    return [];
  }
}

function writeQueue(items: NativeSharePayload[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(items.slice(-20)));
  } catch {
    // A storage failure only loses the cross-launch queue; the in-memory event still fires.
  }
}

async function materialize(payload: NativeSharePayload): Promise<SharedCapture> {
  const files: File[] = [];
  for (const item of payload.files ?? []) {
    try {
      let url = item.path;
      try {
        const { Capacitor } = await import('@capacitor/core');
        url = Capacitor.convertFileSrc(item.path);
      } catch {
        // Browser/Harmony file URLs can be fetched directly.
      }
      const response = await fetch(url);
      if (!response.ok) continue;
      const blob = await response.blob();
      files.push(new File([blob], item.name || 'shared-media', { type: item.mime || blob.type }));
    } catch {
      // Ignore a single unreadable file; text shares still work.
    }
  }
  return {
    text: payload.text,
    files,
    receivedAt: payload.receivedAt,
    source: payload.source,
  };
}

export function installShareReceiver(): void {
  if (typeof window === 'undefined') return;
  const receiver = window as Window & { __aimdReceiveShare?: (payload: NativeSharePayload) => void };
  receiver.__aimdReceiveShare = (payload) => {
    if (!payload || typeof payload !== 'object') return;
    const queue = readQueue();
    if (payload.id && queue.some((item) => item.id === payload.id)) return;
    queue.push(payload);
    writeQueue(queue);
    window.dispatchEvent(new CustomEvent(EVENT));
  };
}

export async function consumeNextShare(): Promise<SharedCapture | null> {
  const queue = readQueue();
  const next = queue.shift();
  if (!next) return null;
  writeQueue(queue);
  return materialize(next);
}

export function subscribeShares(callback: () => void): () => void {
  window.addEventListener(EVENT, callback);
  return () => window.removeEventListener(EVENT, callback);
}
