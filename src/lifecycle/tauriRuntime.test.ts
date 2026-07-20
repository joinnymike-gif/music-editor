import { describe, expect, it } from "vitest";
import {
  assertDesktopRuntime,
  desktopRuntimeRequiredMessage,
} from "./tauriRuntime";

describe("桌面文件能力前置检查", () => {
  it("拒绝在浏览器开发预览中调用桌面文件能力", () => {
    expect(() => assertDesktopRuntime(undefined)).toThrow(
      desktopRuntimeRequiredMessage,
    );
  });

  it("接受桌面壳提供的运行时标识", () => {
    expect(() =>
      assertDesktopRuntime({ invoke: () => undefined }),
    ).not.toThrow();
  });
});
