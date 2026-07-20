import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

export interface LocalEnvironmentOptions {
  environment?: NodeJS.ProcessEnv;
  cwd?: string;
  platform?: NodeJS.Platform;
}

/**
 * Loads a developer-owned, ignored environment file for the loopback gateway.
 * Process environment still wins so CI and production deployment do not depend
 * on a file in the repository checkout.
 */
export function loadLocalGatewayEnvironment(
  options: LocalEnvironmentOptions = {},
): NodeJS.ProcessEnv {
  const environment = options.environment ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const platform = options.platform ?? process.platform;
  const filePath = environment.GATEWAY_LOCAL_ENV_FILE
    ? resolve(cwd, environment.GATEWAY_LOCAL_ENV_FILE)
    : resolve(cwd, "gateway/.env.local");

  if (!existsSync(filePath)) return environment;
  assertOwnerOnlyPermissions(filePath, platform);
  const localValues = parseEnvironmentFile(readFileSync(filePath, "utf8"));
  return { ...localValues, ...environment };
}

export function parseEnvironmentFile(source: string): NodeJS.ProcessEnv {
  const values: NodeJS.ProcessEnv = {};
  for (const [index, rawLine] of source.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const assignment = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (!assignment) {
      throw new Error(`本地环境文件第 ${index + 1} 行格式无效。`);
    }
    const [, name, rawValue] = assignment;
    values[name] = parseEnvironmentValue(rawValue);
  }
  return values;
}

function parseEnvironmentValue(rawValue: string): string {
  const value = rawValue.trim();
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function assertOwnerOnlyPermissions(
  filePath: string,
  platform: NodeJS.Platform,
): void {
  if (platform === "win32") return;
  const permissions = statSync(filePath).mode & 0o777;
  if ((permissions & 0o077) !== 0) {
    throw new Error(
      `本地环境文件权限过宽：${filePath}。请执行 chmod 600 ${filePath}。`,
    );
  }
}
