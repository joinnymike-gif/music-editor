import type { InstrumentEntry } from "../instruments/registry";
import { decodePcmWav, type PcmWavBuffer } from "./pcmWav";

/**
 * A small, curated starter bank of recorded instruments.  The source material
 * is intentionally kept separate from Tone's procedural voices: callers can
 * make an explicit, deterministic decision about whether a real recording is
 * available for a given instrument.
 */
export interface SampleLayer {
  readonly rootMidi: number;
  readonly url: string;
  readonly sha256: string;
  /**
   * Leading room tone in the original recording, measured from the rendered
   * PCM file. Playback starts at this musical onset rather than making a
   * keyboard player wait through recording pre-roll.
   */
  readonly onsetSeconds: number;
}

/**
 * Vite serves files under public/ from BASE_URL. Using that base rather than a
 * hard-coded origin keeps packaged Tauri builds on their own tauri.localhost
 * origin, where the same-origin CSP rule can authorise the fetch.
 */
const publicBase = import.meta.env.BASE_URL.endsWith("/")
  ? import.meta.env.BASE_URL
  : `${import.meta.env.BASE_URL}/`;
const iowaMis = `${publicBase}samples/iowa-mis/`;

const layersByInstrument: Readonly<
  Partial<Record<InstrumentEntry["id"], readonly SampleLayer[]>>
> = {
  acoustic_piano: [
    {
      rootMidi: 48,
      url: `${iowaMis}piano-c3.wav`,
      sha256:
        "0311e5c8a04042697d1b82471133a02acaaca1f01a2526b6f293ef624d7ffcdc",
      onsetSeconds: 0.557,
    },
    {
      rootMidi: 60,
      url: `${iowaMis}piano-c4.wav`,
      sha256:
        "884a64413506578e98a6b6998a9571ee3ea500c3accccffbf166d6b66e0bdc5e",
      onsetSeconds: 0.345,
    },
    {
      rootMidi: 72,
      url: `${iowaMis}piano-c5.wav`,
      sha256:
        "ea5acb02cb722b22126ddfb7c117a894833d421d03d243e4a203d927da68e47b",
      onsetSeconds: 0.428,
    },
  ],
  electric_piano: [
    {
      rootMidi: 50,
      url: `${iowaMis}rhodes-d3.wav`,
      sha256:
        "2061b411d8f463f72eb804a4b5cfc5dd3e8a04afb6dd84d880189b909882d841",
      onsetSeconds: 0,
    },
    {
      rootMidi: 65,
      url: `${iowaMis}rhodes-f4.wav`,
      sha256:
        "dcfa7fc6ca327ad82fc5b1824bfbb17620c7840f40da8585f866222cb77f3d81",
      onsetSeconds: 0,
    },
    {
      rootMidi: 71,
      url: `${iowaMis}rhodes-b4.wav`,
      sha256:
        "e47da9fc66bbd200f7f6327bcd4271452d5060cef93f5441274fc702ccc2926f",
      onsetSeconds: 0,
    },
  ],
  acoustic_guitar: [
    {
      rootMidi: 48,
      url: `${iowaMis}guitar-c3.wav`,
      sha256:
        "243870ef73b51c65886b8e7254372698d5288a8d9189922f73b18882c7b30f95",
      onsetSeconds: 0.023,
    },
  ],
  finger_bass: [
    {
      rootMidi: 36,
      url: `${iowaMis}bass-c2.wav`,
      sha256:
        "5111f61afc7ec138ed4f1c08e7e072e6dfc7a4e1b024ea5bd01c4035fc8d6a22",
      onsetSeconds: 0,
    },
  ],
  violin: [
    {
      rootMidi: 55,
      url: `${iowaMis}violin-g3.wav`,
      sha256:
        "512c583ca6edeed8ce4d7e8f80f7d971dd8970f2eb306d205979c2cee0ba0704",
      onsetSeconds: 1.989,
    },
  ],
  flute: [
    {
      rootMidi: 72,
      url: `${iowaMis}flute-c5.wav`,
      sha256:
        "173f5a2de8f79c2836571bb838f21ab3552f71ecdebabf5aa9408b33e1753f0d",
      onsetSeconds: 0.482,
    },
  ],
};

export function sampleLayersFor(
  instrumentId: InstrumentEntry["id"],
): readonly SampleLayer[] {
  return layersByInstrument[instrumentId] ?? [];
}

export function hasRecordedSamples(
  instrumentId: InstrumentEntry["id"],
): boolean {
  return sampleLayersFor(instrumentId).length > 0;
}

/**
 * A static capability check for UI controls. This says a real, bundled asset
 * is declared for the instrument; decoding and SHA-256 validation still occur
 * before any note is allowed to sound.
 */
export function hasVerifiedRecordedAsset(
  instrumentId: InstrumentEntry["id"],
): boolean {
  return hasRecordedSamples(instrumentId);
}

/**
 * `square_lead` is deliberately a synthesised instrument.  It is not a
 * missing-recording fallback: its registry entry explicitly identifies the
 * oscillator implementation, so it remains available even though it has no
 * recorded WAV layer.
 */
export function isDeliberateSynthInstrument(
  instrumentId: InstrumentEntry["id"],
): boolean {
  return instrumentId === "square_lead";
}

/**
 * Controls and operation validation use this broader capability check. Real
 * instruments must still pass the recorded-asset chain; only the explicitly
 * declared synth lead may take the oscillator path.
 */
export function isInstrumentPlaybackAvailable(
  instrumentId: InstrumentEntry["id"],
): boolean {
  return (
    hasRecordedSamples(instrumentId) ||
    isDeliberateSynthInstrument(instrumentId)
  );
}

export function recordedAssetUnavailableMessage(
  instrument: Pick<InstrumentEntry, "id" | "name">,
): string {
  if (isDeliberateSynthInstrument(instrument.id)) {
    return `${instrument.name} 是内置合成音源，不需要真实采样。`;
  }
  return hasRecordedSamples(instrument.id)
    ? `真实采样 ${instrument.name} 加载失败；为避免回退为电子音，已阻止播放。`
    : `${instrument.name} 尚未附带真实采样，当前已禁用。`;
}

export function closestSampleLayer(
  instrumentId: InstrumentEntry["id"],
  midi: number,
): SampleLayer | undefined {
  return sampleLayersFor(instrumentId).reduce<SampleLayer | undefined>(
    (closest, layer) =>
      !closest ||
      Math.abs(layer.rootMidi - midi) < Math.abs(closest.rootMidi - midi)
        ? layer
        : closest,
    undefined,
  );
}

const decodedByUrl = new Map<string, Promise<AudioBuffer>>();
const decodedBuffersByUrl = new Map<string, AudioBuffer>();
const decodedPcmByUrl = new Map<string, Promise<PcmWavBuffer>>();
const verifiedPayloadByUrl = new Map<string, Promise<ArrayBuffer>>();

export async function loadRecordedSamples(
  context: BaseAudioContext,
  instrumentId: InstrumentEntry["id"],
): Promise<ReadonlyMap<SampleLayer, AudioBuffer>> {
  const layers = sampleLayersFor(instrumentId);
  if (layers.length === 0) {
    throw new Error(`乐器 ${instrumentId} 未声明真实采样。`);
  }
  const decoded = await Promise.all(
    layers.map(
      async (layer) => [layer, await decodeLayer(context, layer)] as const,
    ),
  );
  return new Map(decoded);
}

export async function preloadRecordedSamples(
  context: BaseAudioContext,
  instrumentIds: Iterable<InstrumentEntry["id"]>,
): Promise<void> {
  const uniqueIds = new Set(instrumentIds);
  await Promise.all(
    [...uniqueIds].map((id) => loadRecordedSamples(context, id)),
  );
}

/**
 * Loads real PCM samples for the offline renderer without `OfflineAudioContext`.
 * It shares the same fetched bytes and SHA-256 verification as realtime audio.
 */
export async function loadRecordedPcmSamplesForRender(
  instrumentId: InstrumentEntry["id"],
): Promise<ReadonlyMap<SampleLayer, PcmWavBuffer>> {
  const layers = sampleLayersFor(instrumentId);
  if (layers.length === 0) {
    throw new Error(`乐器 ${instrumentId} 未声明真实采样。`);
  }
  const decoded = await Promise.all(
    layers.map(async (layer) => [layer, await decodePcmLayer(layer)] as const),
  );
  return new Map(decoded);
}

/** Decode only the layer that an immediate keyboard audition will use. */
export async function preloadRecordedSampleForMidi(
  context: BaseAudioContext,
  instrumentId: InstrumentEntry["id"],
  midi: number,
): Promise<void> {
  const layer = closestSampleLayer(instrumentId, midi);
  if (!layer) throw new Error(`乐器 ${instrumentId} 未声明真实采样。`);
  await decodeLayer(context, layer);
}

export function loadedRecordedSamples(
  instrumentId: InstrumentEntry["id"],
): ReadonlyMap<SampleLayer, AudioBuffer> | undefined {
  const layers = sampleLayersFor(instrumentId);
  const loaded = layers
    .filter((layer) => decodedBuffersByUrl.has(layer.url))
    .map((layer) => [layer, decodedBuffersByUrl.get(layer.url)!] as const);
  return loaded.length > 0 ? new Map(loaded) : undefined;
}

async function decodeLayer(
  context: BaseAudioContext,
  layer: SampleLayer,
): Promise<AudioBuffer> {
  const cached = decodedByUrl.get(layer.url);
  if (cached) return cached;
  const request = verifiedPayload(layer)
    .then((payload) => context.decodeAudioData(payload.slice(0)))
    .then((buffer) => {
      decodedBuffersByUrl.set(layer.url, buffer);
      return buffer;
    })
    .catch((error: unknown) => {
      // A rejected cache entry would otherwise make every future audition fail
      // until restart, including after a transient resource-load error.
      decodedByUrl.delete(layer.url);
      throw error;
    });
  decodedByUrl.set(layer.url, request);
  return request;
}

async function decodePcmLayer(layer: SampleLayer): Promise<PcmWavBuffer> {
  const cached = decodedPcmByUrl.get(layer.url);
  if (cached) return cached;
  const request = verifiedPayload(layer)
    .then((payload) => decodePcmWav(payload))
    .catch((error: unknown) => {
      decodedPcmByUrl.delete(layer.url);
      throw error;
    });
  decodedPcmByUrl.set(layer.url, request);
  return request;
}

async function verifiedPayload(layer: SampleLayer): Promise<ArrayBuffer> {
  const cached = verifiedPayloadByUrl.get(layer.url);
  if (cached) return cached;
  const request = fetch(layer.url)
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(
          `无法读取内置采样 ${layer.url}（${response.status}）。`,
        );
      }
      const payload = await response.arrayBuffer();
      await verifyLayerIntegrity(payload, layer);
      return payload;
    })
    .catch((error: unknown) => {
      verifiedPayloadByUrl.delete(layer.url);
      throw error;
    });
  verifiedPayloadByUrl.set(layer.url, request);
  return request;
}

async function verifyLayerIntegrity(
  payload: ArrayBuffer,
  layer: SampleLayer,
): Promise<void> {
  if (!globalThis.crypto?.subtle) {
    throw new Error("当前运行时不支持内置音色完整性校验。");
  }
  const digest = await globalThis.crypto.subtle.digest("SHA-256", payload);
  const actual = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  if (actual !== layer.sha256) {
    throw new Error(`内置采样 ${layer.url} 的完整性校验失败。`);
  }
}
