/** A small, dependency-free representation used by the offline WAV renderer. */
export interface PcmWavBuffer {
  readonly length: number;
  readonly numberOfChannels: number;
  readonly sampleRate: number;
  getChannelData(channel: number): Float32Array;
}

/**
 * Decodes the compact, bundled PCM WAV layers without relying on Web Audio.
 * This gives Node-based exports exactly the same recorded source material as
 * the desktop renderer instead of a test-only AudioContext substitute.
 */
export function decodePcmWav(payload: ArrayBuffer): PcmWavBuffer {
  const view = new DataView(payload);
  if (ascii(view, 0, 4) !== "RIFF" || ascii(view, 8, 4) !== "WAVE") {
    throw new Error("内置采样不是有效的 RIFF/WAVE 文件。");
  }

  let audioFormat: number | undefined;
  let channels: number | undefined;
  let sampleRate: number | undefined;
  let bitsPerSample: number | undefined;
  let dataOffset: number | undefined;
  let dataLength: number | undefined;
  let offset = 12;
  while (offset + 8 <= view.byteLength) {
    const chunkId = ascii(view, offset, 4);
    const chunkLength = view.getUint32(offset + 4, true);
    const chunkDataOffset = offset + 8;
    if (chunkDataOffset + chunkLength > view.byteLength) {
      throw new Error("内置采样的 WAV chunk 长度无效。 ");
    }
    if (chunkId === "fmt ") {
      if (chunkLength < 16) throw new Error("内置采样缺少 WAV fmt 信息。 ");
      audioFormat = view.getUint16(chunkDataOffset, true);
      channels = view.getUint16(chunkDataOffset + 2, true);
      sampleRate = view.getUint32(chunkDataOffset + 4, true);
      bitsPerSample = view.getUint16(chunkDataOffset + 14, true);
    } else if (chunkId === "data") {
      dataOffset = chunkDataOffset;
      dataLength = chunkLength;
    }
    offset = chunkDataOffset + chunkLength + (chunkLength % 2);
  }

  if (
    audioFormat !== 1 ||
    !channels ||
    !sampleRate ||
    !bitsPerSample ||
    dataOffset === undefined ||
    dataLength === undefined
  ) {
    throw new Error("内置采样必须是未压缩的 PCM WAV。 ");
  }
  if (!([8, 16, 24, 32] as number[]).includes(bitsPerSample)) {
    throw new Error(`不支持 ${bitsPerSample}-bit PCM WAV 采样。`);
  }
  const bytesPerSample = bitsPerSample / 8;
  const frameSize = bytesPerSample * channels;
  const frames = Math.floor(dataLength / frameSize);
  const channelData = Array.from(
    { length: channels },
    () => new Float32Array(frames),
  );
  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const sampleOffset =
        dataOffset + frame * frameSize + channel * bytesPerSample;
      channelData[channel]![frame] = pcmSampleAt(
        view,
        sampleOffset,
        bitsPerSample,
      );
    }
  }
  return {
    length: frames,
    numberOfChannels: channels,
    sampleRate,
    getChannelData: (channel) => {
      const data = channelData[channel];
      if (!data) throw new RangeError(`WAV 不存在通道 ${channel}。`);
      return data;
    },
  };
}

function pcmSampleAt(view: DataView, offset: number, bits: number): number {
  if (bits === 8) return (view.getUint8(offset) - 128) / 128;
  if (bits === 16) return view.getInt16(offset, true) / 32_768;
  if (bits === 24) {
    const unsigned =
      view.getUint8(offset) |
      (view.getUint8(offset + 1) << 8) |
      (view.getUint8(offset + 2) << 16);
    const signed = unsigned & 0x80_0000 ? unsigned - 0x1_00_0000 : unsigned;
    return signed / 8_388_608;
  }
  return view.getInt32(offset, true) / 2_147_483_648;
}

function ascii(view: DataView, offset: number, length: number): string {
  return Array.from({ length }, (_, index) =>
    String.fromCharCode(view.getUint8(offset + index)),
  ).join("");
}
