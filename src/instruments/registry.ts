import type { TrackRole } from "../doc/types";

export const currentInstrumentRegistryVersion = "1.0" as const;

export type ProceduralInstrumentKind =
  | "acousticKit"
  | "fingerBass"
  | "squareLead"
  | "acousticPiano"
  | "electricPiano"
  | "acousticGuitar"
  | "violin"
  | "flute";

type ProceduralAsset = {
  source: "bundled-procedural";
  package: "tone@15.1.22";
  entryPoint: "node_modules/tone/build/Tone.js";
  sha256: "e290952fa43d9a7a780182a83c6fccf44d79cb7ae2cba102ef1f2b9d98124e22";
  licenseId: "MIT";
};

type RecordedAsset = {
  source: "bundled-recorded";
  package: string;
  sourceUrl: string;
  licenseId: string;
  attribution: string;
  /** Hashes of the compact WAV layers shipped with this application. */
  layers: readonly { path: string; sha256: string }[];
};

export interface InstrumentEntry {
  id:
    | "acoustic_kit"
    | "finger_bass"
    | "square_lead"
    | "acoustic_piano"
    | "electric_piano"
    | "acoustic_guitar"
    | "violin"
    | "flute";
  name: string;
  registryVersion: typeof currentInstrumentRegistryVersion;
  roles: readonly TrackRole[];
  asset: ProceduralAsset | RecordedAsset;
  implementation: ProceduralInstrumentKind;
  render: { realtime: true; offline: true };
  midi: { channel: "drum" | "melodic"; program?: number };
  automation: { volume: true; filterCutoff: boolean };
  defaultGainDb: number;
}

export const instrumentRegistry: readonly InstrumentEntry[] = [
  {
    id: "acoustic_kit",
    name: "原声鼓组",
    registryVersion: currentInstrumentRegistryVersion,
    roles: ["drums"],
    asset: {
      source: "bundled-procedural",
      package: "tone@15.1.22",
      entryPoint: "node_modules/tone/build/Tone.js",
      sha256:
        "e290952fa43d9a7a780182a83c6fccf44d79cb7ae2cba102ef1f2b9d98124e22",
      licenseId: "MIT",
    },
    implementation: "acousticKit",
    render: { realtime: true, offline: true },
    midi: { channel: "drum" },
    automation: { volume: true, filterCutoff: false },
    defaultGainDb: -7,
  },
  {
    id: "finger_bass",
    name: "指弹贝斯",
    registryVersion: currentInstrumentRegistryVersion,
    roles: ["bass"],
    asset: {
      source: "bundled-recorded",
      package: "University of Iowa Musical Instrument Samples",
      sourceUrl: "https://theremin.music.uiowa.edu/MIS.html",
      licenseId: "University of Iowa unrestricted project use",
      attribution: "University of Iowa Electronic Music Studios",
      layers: [
        {
          path: "public/samples/iowa-mis/bass-c2.wav",
          sha256:
            "5111f61afc7ec138ed4f1c08e7e072e6dfc7a4e1b024ea5bd01c4035fc8d6a22",
        },
      ],
    },
    implementation: "fingerBass",
    render: { realtime: true, offline: true },
    midi: { channel: "melodic", program: 33 },
    automation: { volume: true, filterCutoff: true },
    defaultGainDb: -9,
  },
  {
    id: "square_lead",
    name: "合成主音",
    registryVersion: currentInstrumentRegistryVersion,
    roles: ["lead", "harmony", "pad", "fx"],
    asset: {
      source: "bundled-procedural",
      package: "tone@15.1.22",
      entryPoint: "node_modules/tone/build/Tone.js",
      sha256:
        "e290952fa43d9a7a780182a83c6fccf44d79cb7ae2cba102ef1f2b9d98124e22",
      licenseId: "MIT",
    },
    implementation: "squareLead",
    render: { realtime: true, offline: true },
    midi: { channel: "melodic", program: 80 },
    automation: { volume: true, filterCutoff: true },
    defaultGainDb: -11,
  },
  {
    id: "acoustic_piano",
    name: "钢琴",
    registryVersion: currentInstrumentRegistryVersion,
    roles: ["lead", "harmony", "pad"],
    asset: {
      source: "bundled-recorded",
      package: "University of Iowa Musical Instrument Samples",
      sourceUrl: "https://theremin.music.uiowa.edu/MIS.html",
      licenseId: "University of Iowa unrestricted project use",
      attribution: "University of Iowa Electronic Music Studios",
      layers: [
        {
          path: "public/samples/iowa-mis/piano-c3.wav",
          sha256:
            "0311e5c8a04042697d1b82471133a02acaaca1f01a2526b6f293ef624d7ffcdc",
        },
        {
          path: "public/samples/iowa-mis/piano-c4.wav",
          sha256:
            "884a64413506578e98a6b6998a9571ee3ea500c3accccffbf166d6b66e0bdc5e",
        },
        {
          path: "public/samples/iowa-mis/piano-c5.wav",
          sha256:
            "ea5acb02cb722b22126ddfb7c117a894833d421d03d243e4a203d927da68e47b",
        },
      ],
    },
    implementation: "acousticPiano",
    render: { realtime: true, offline: true },
    midi: { channel: "melodic", program: 0 },
    automation: { volume: true, filterCutoff: true },
    defaultGainDb: -10,
  },
  {
    id: "electric_piano",
    name: "电钢琴",
    registryVersion: currentInstrumentRegistryVersion,
    roles: ["lead", "harmony", "pad"],
    asset: {
      source: "bundled-recorded",
      package: "J. Learman Rhodes Mark I samples",
      sourceUrl: "https://github.com/danigb/samples/tree/main/audio/jlearman",
      licenseId: "CC0 1.0",
      attribution: "J. Learman / sfzinstruments",
      layers: [
        {
          path: "public/samples/iowa-mis/rhodes-d3.wav",
          sha256:
            "2061b411d8f463f72eb804a4b5cfc5dd3e8a04afb6dd84d880189b909882d841",
        },
        {
          path: "public/samples/iowa-mis/rhodes-f4.wav",
          sha256:
            "dcfa7fc6ca327ad82fc5b1824bfbb17620c7840f40da8585f866222cb77f3d81",
        },
        {
          path: "public/samples/iowa-mis/rhodes-b4.wav",
          sha256:
            "e47da9fc66bbd200f7f6327bcd4271452d5060cef93f5441274fc702ccc2926f",
        },
      ],
    },
    implementation: "electricPiano",
    render: { realtime: true, offline: true },
    midi: { channel: "melodic", program: 4 },
    automation: { volume: true, filterCutoff: true },
    defaultGainDb: -12,
  },
  {
    id: "acoustic_guitar",
    name: "原声吉他",
    registryVersion: currentInstrumentRegistryVersion,
    roles: ["lead", "harmony"],
    asset: {
      source: "bundled-recorded",
      package: "University of Iowa Musical Instrument Samples",
      sourceUrl: "https://theremin.music.uiowa.edu/MIS.html",
      licenseId: "University of Iowa unrestricted project use",
      attribution: "University of Iowa Electronic Music Studios",
      layers: [
        {
          path: "public/samples/iowa-mis/guitar-c3.wav",
          sha256:
            "243870ef73b51c65886b8e7254372698d5288a8d9189922f73b18882c7b30f95",
        },
      ],
    },
    implementation: "acousticGuitar",
    render: { realtime: true, offline: true },
    midi: { channel: "melodic", program: 24 },
    automation: { volume: true, filterCutoff: true },
    defaultGainDb: -13,
  },
  {
    id: "violin",
    name: "小提琴",
    registryVersion: currentInstrumentRegistryVersion,
    roles: ["lead", "harmony", "pad"],
    asset: {
      source: "bundled-recorded",
      package: "University of Iowa Musical Instrument Samples",
      sourceUrl: "https://theremin.music.uiowa.edu/MIS.html",
      licenseId: "University of Iowa unrestricted project use",
      attribution: "University of Iowa Electronic Music Studios",
      layers: [
        {
          path: "public/samples/iowa-mis/violin-g3.wav",
          sha256:
            "512c583ca6edeed8ce4d7e8f80f7d971dd8970f2eb306d205979c2cee0ba0704",
        },
      ],
    },
    implementation: "violin",
    render: { realtime: true, offline: true },
    midi: { channel: "melodic", program: 40 },
    automation: { volume: true, filterCutoff: true },
    defaultGainDb: -14,
  },
  {
    id: "flute",
    name: "长笛",
    registryVersion: currentInstrumentRegistryVersion,
    roles: ["lead", "harmony", "pad"],
    asset: {
      source: "bundled-recorded",
      package: "University of Iowa Musical Instrument Samples",
      sourceUrl: "https://theremin.music.uiowa.edu/MISflute.html",
      licenseId: "University of Iowa unrestricted project use",
      attribution: "University of Iowa Electronic Music Studios / Sonja Feig",
      layers: [
        {
          path: "public/samples/iowa-mis/flute-c5.wav",
          sha256:
            "173f5a2de8f79c2836571bb838f21ab3552f71ecdebabf5aa9408b33e1753f0d",
        },
      ],
    },
    implementation: "flute",
    render: { realtime: true, offline: true },
    midi: { channel: "melodic", program: 73 },
    automation: { volume: true, filterCutoff: true },
    defaultGainDb: -15,
  },
];

export function resolveInstrument(
  registryVersion: string,
  instrumentId: string,
): InstrumentEntry | undefined {
  if (registryVersion !== currentInstrumentRegistryVersion) return undefined;
  return instrumentRegistry.find((entry) => entry.id === instrumentId);
}

export function isInstrumentCompatible(
  role: TrackRole,
  instrument: InstrumentEntry,
): boolean {
  return (
    instrument.roles.includes(role) &&
    (role === "drums"
      ? instrument.midi.channel === "drum"
      : instrument.midi.channel === "melodic")
  );
}

export function instrumentsForRole(
  role: TrackRole,
): readonly InstrumentEntry[] {
  return instrumentRegistry.filter((entry) =>
    isInstrumentCompatible(role, entry),
  );
}

export function keyboardAuditionInstruments(): readonly InstrumentEntry[] {
  return instrumentRegistry.filter((entry) => entry.midi.channel === "melodic");
}

export function instrumentName(instrumentId: string): string {
  return (
    resolveInstrument(currentInstrumentRegistryVersion, instrumentId)?.name ??
    instrumentId
  );
}
