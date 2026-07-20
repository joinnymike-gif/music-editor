import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { instrumentRegistry } from "../instruments/registry";
import { sampleLayersFor } from "./sampleBank";

describe("内置实录采样包", () => {
  it("每个注册的录音层都随应用存在，并与注册表哈希一致", () => {
    for (const entry of instrumentRegistry) {
      if (entry.asset.source !== "bundled-recorded") continue;
      const runtimeLayers = sampleLayersFor(entry.id);
      expect(runtimeLayers).toHaveLength(entry.asset.layers.length);
      expect(runtimeLayers.every((layer) => layer.onsetSeconds >= 0)).toBe(
        true,
      );
      for (const layer of entry.asset.layers) {
        const absolutePath = resolve(process.cwd(), layer.path);
        expect(existsSync(absolutePath)).toBe(true);
        expect(sha256Of(absolutePath)).toBe(layer.sha256);
      }
    }
  });

  it("钢琴与小提琴的录音前导会被显式跳过，避免低八度试听等待空白", () => {
    expect(
      sampleLayersFor("acoustic_piano").map((layer) => layer.onsetSeconds),
    ).toEqual([0.557, 0.345, 0.428]);
    expect(sampleLayersFor("violin")[0]?.onsetSeconds).toBe(1.989);
    expect(sampleLayersFor("finger_bass")[0]?.onsetSeconds).toBe(0);
  });
});

function sha256Of(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
