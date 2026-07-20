type TauriGlobal = typeof globalThis & {
  __TAURI_INTERNALS__?: unknown;
};

export const desktopRuntimeRequiredMessage =
  "当前为浏览器开发预览，文件操作仅能在 AI Music IDE 桌面应用中执行。";

export function assertDesktopRuntime(
  runtime: unknown = (globalThis as TauriGlobal).__TAURI_INTERNALS__,
): void {
  if (!runtime) throw new Error(desktopRuntimeRequiredMessage);
}
