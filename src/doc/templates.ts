import { currentInstrumentRegistryVersion } from "../instruments/registry";
import { assertValidProjectDocument } from "./schema";
import { schemaVersion, type ProjectDocument, type Track } from "./types";

export type ProjectTemplate =
  "blank" | "lofi" | "electronic" | "popInstrumental";

export interface CreateProjectOptions {
  now?: Date;
  createId?: () => string;
}

const templateDefinitions: Record<
  ProjectTemplate,
  {
    name: string;
    sections: Array<{ name: string; bars: number }>;
    tracks: TrackSeed[];
  }
> = {
  blank: {
    name: "Untitled project",
    sections: [{ name: "Idea", bars: 8 }],
    tracks: [
      { name: "Lead", role: "lead", instrument: "acoustic_piano", vol: 0.7 },
    ],
  },
  lofi: {
    name: "Lo-fi sketch",
    sections: [
      { name: "Verse", bars: 8 },
      { name: "Chorus", bars: 8 },
    ],
    tracks: defaultBandTracks(),
  },
  electronic: {
    name: "Electronic sketch",
    sections: [
      { name: "Build", bars: 8 },
      { name: "Drop", bars: 8 },
    ],
    tracks: defaultBandTracks(),
  },
  popInstrumental: {
    name: "Pop instrumental sketch",
    sections: [
      { name: "Verse", bars: 8 },
      { name: "Chorus", bars: 8 },
    ],
    tracks: defaultBandTracks(),
  },
};

type TrackSeed = Pick<Track, "name" | "role" | "instrument" | "vol">;

function defaultBandTracks(): TrackSeed[] {
  return [
    {
      name: "Rhythm piano",
      role: "harmony",
      instrument: "acoustic_piano",
      vol: 0.7,
    },
    { name: "Bass", role: "bass", instrument: "finger_bass", vol: 0.78 },
    { name: "Lead", role: "lead", instrument: "violin", vol: 0.62 },
  ];
}

export function createProject(
  template: ProjectTemplate,
  options: CreateProjectOptions = {},
): ProjectDocument {
  const definition = templateDefinitions[template];
  const createId = options.createId ?? (() => crypto.randomUUID());
  const timestamp = (options.now ?? new Date()).toISOString();
  const sections = definition.sections.map((section) => ({
    id: createId(),
    name: section.name,
    bars: section.bars,
  }));
  const tracks = definition.tracks.map((track) => ({
    id: createId(),
    ...track,
    mute: false,
    solo: false,
  }));

  return assertValidProjectDocument({
    schemaVersion,
    id: createId(),
    name: definition.name,
    createdAt: timestamp,
    updatedAt: timestamp,
    meta: {
      tempo: 120,
      key: "C",
      mode: "minor",
      timeSig: [4, 4],
      instrumentRegistryVersion: currentInstrumentRegistryVersion,
    },
    sections,
    tracks,
    clips: [],
    automation: [],
  });
}
