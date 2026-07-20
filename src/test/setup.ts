// React 19 要求测试环境显式声明 act 支持，避免异步 UI 更新遗漏告警。
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no Web Audio decoder. Provide a deliberately small test-only
// OfflineAudioContext so WAV export follows the same verified-sample path as
// the desktop app instead of reintroducing a procedural fallback in tests.
class TestOfflineAudioContext {
  decodeAudioData = async (payload: ArrayBuffer): Promise<AudioBuffer> => {
    void payload;
    const sampleFrames = 44_100 * 6;
    return {
      getChannelData: () => new Float32Array(sampleFrames).fill(0.2),
      length: sampleFrames,
      numberOfChannels: 1,
      sampleRate: 44_100,
    } as unknown as AudioBuffer;
  };

  constructor(channels: number, length: number, sampleRate: number) {
    void channels;
    void length;
    void sampleRate;
  }
}

if (typeof globalThis.OfflineAudioContext !== "function") {
  (
    globalThis as typeof globalThis & {
      OfflineAudioContext?: typeof OfflineAudioContext;
    }
  ).OfflineAudioContext =
    TestOfflineAudioContext as unknown as typeof OfflineAudioContext;
}

const platformFetch = globalThis.fetch;
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const pathname = new URL(String(input), "http://localhost").pathname;
  if (pathname.startsWith("/samples/iowa-mis/")) {
    const file = readFileSync(
      resolve(process.cwd(), "public", pathname.slice(1)),
    );
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () =>
        file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength),
    } as Response;
  }
  if (platformFetch) return platformFetch(input, init);
  throw new Error(`测试环境无法请求 ${String(input)}。`);
};
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
