import { describe, expect, it } from "vitest";
import {
  currentInstrumentRegistryVersion,
  instrumentRegistry,
  instrumentsForRole,
  isInstrumentCompatible,
  keyboardAuditionInstruments,
  resolveInstrument,
} from "./registry";

describe("instrument registry v1", () => {
  it("解析内置乐器及其录音/程序化资产完整性元数据", () => {
    expect(instrumentRegistry.map((entry) => entry.id)).toEqual([
      "acoustic_kit",
      "finger_bass",
      "square_lead",
      "acoustic_piano",
      "electric_piano",
      "acoustic_guitar",
      "violin",
      "flute",
    ]);
    for (const entry of instrumentRegistry) {
      if (entry.asset.source === "bundled-recorded") {
        expect(entry.asset.layers.length).toBeGreaterThan(0);
        entry.asset.layers.forEach((layer) =>
          expect(layer.sha256).toMatch(/^[a-f0-9]{64}$/),
        );
        expect(entry.asset.attribution.length).toBeGreaterThan(3);
      } else {
        expect(entry.asset.sha256).toMatch(/^[a-f0-9]{64}$/);
        expect(entry.asset.licenseId).toBe("MIT");
      }
      expect(entry.render.realtime).toBe(true);
    }
  });

  it("按版本解析并拒绝未知版本或乐器", () => {
    expect(
      resolveInstrument(currentInstrumentRegistryVersion, "finger_bass")?.midi
        .program,
    ).toBe(33);
    expect(resolveInstrument("0.9", "finger_bass")).toBeUndefined();
    expect(
      resolveInstrument(currentInstrumentRegistryVersion, "unknown"),
    ).toBeUndefined();
  });

  it("只允许角色与 MIDI 通道相容的组合", () => {
    const kit = resolveInstrument(
      currentInstrumentRegistryVersion,
      "acoustic_kit",
    );
    const lead = resolveInstrument(
      currentInstrumentRegistryVersion,
      "square_lead",
    );
    if (!kit || !lead) throw new Error("缺少内置乐器。");
    expect(isInstrumentCompatible("drums", kit)).toBe(true);
    expect(isInstrumentCompatible("lead", kit)).toBe(false);
    expect(isInstrumentCompatible("drums", lead)).toBe(false);
    expect(instrumentsForRole("lead").map((entry) => entry.id)).toEqual([
      "square_lead",
      "acoustic_piano",
      "electric_piano",
      "acoustic_guitar",
      "violin",
      "flute",
    ]);
    expect(keyboardAuditionInstruments()).toHaveLength(7);
  });
});
