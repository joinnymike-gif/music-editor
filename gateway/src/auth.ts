import {
  createHmac,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { GatewayError } from "./errors.js";
import type { AuthenticatedAccount, SessionClaims } from "./types.js";

interface StoredAccount extends AuthenticatedAccount {
  passwordHash: string;
  createdAt: string;
}

export interface AccountStore {
  findByEmail(email: string): Promise<StoredAccount | undefined>;
  findById(id: string): Promise<StoredAccount | undefined>;
  create(account: StoredAccount): Promise<void>;
}

/** Development-only adapter. It deliberately loses accounts when the process exits. */
export class MemoryAccountStore implements AccountStore {
  private readonly accountsById = new Map<string, StoredAccount>();
  private readonly idsByEmail = new Map<string, string>();

  async findByEmail(email: string): Promise<StoredAccount | undefined> {
    const id = this.idsByEmail.get(email);
    return id ? this.accountsById.get(id) : undefined;
  }

  async findById(id: string): Promise<StoredAccount | undefined> {
    return this.accountsById.get(id);
  }

  async create(account: StoredAccount): Promise<void> {
    this.accountsById.set(account.id, account);
    this.idsByEmail.set(account.email, account.id);
  }
}

export interface AuthClock {
  nowSeconds(): number;
}

const systemClock: AuthClock = {
  nowSeconds: () => Math.floor(Date.now() / 1_000),
};

export class ProductAuthService {
  private readonly revokedSessionExpiries = new Map<string, number>();
  private readonly localIdentityCodes = new Map<
    string,
    { accountId: string; expiresAt: number }
  >();

  constructor(
    private readonly accounts: AccountStore,
    private readonly secret: string,
    private readonly sessionTtlSeconds: number,
    private readonly clock: AuthClock = systemClock,
  ) {}

  async register(
    emailInput: unknown,
    passwordInput: unknown,
  ): Promise<AuthenticatedAccount> {
    const email = normalizeEmail(emailInput);
    const password = validatePassword(passwordInput);
    if (await this.accounts.findByEmail(email)) {
      throw new GatewayError(
        409,
        "account_exists",
        "该邮箱已注册，请直接登录。",
      );
    }
    const account: StoredAccount = {
      id: randomUUID(),
      email,
      passwordHash: hashPassword(password),
      createdAt: new Date().toISOString(),
    };
    await this.accounts.create(account);
    return toPublicAccount(account);
  }

  async login(emailInput: unknown, passwordInput: unknown): Promise<string> {
    const email = normalizeEmail(emailInput);
    const password = validatePassword(passwordInput);
    const account = await this.accounts.findByEmail(email);
    if (!account || !verifyPassword(password, account.passwordHash)) {
      throw new GatewayError(401, "invalid_credentials", "邮箱或密码不正确。");
    }
    return this.issueSession(toPublicAccount(account));
  }

  /** Local-demo only: simulates an identity provider's one-time callback code. */
  async beginLocalMockIdentity(emailInput: unknown): Promise<string> {
    const email = normalizeEmail(emailInput);
    let account = await this.accounts.findByEmail(email);
    if (!account) {
      account = {
        id: randomUUID(),
        email,
        passwordHash: hashPassword(randomBytes(32).toString("base64url")),
        createdAt: new Date().toISOString(),
      };
      await this.accounts.create(account);
    }
    const code = randomUUID();
    this.localIdentityCodes.set(code, {
      accountId: account.id,
      expiresAt: this.clock.nowSeconds() + 120,
    });
    this.pruneLocalIdentityCodes();
    return code;
  }

  async exchangeLocalMockIdentity(
    codeInput: unknown,
  ): Promise<{ account: AuthenticatedAccount; accessToken: string }> {
    if (typeof codeInput !== "string") {
      throw new GatewayError(
        400,
        "invalid_identity_code",
        "本地登录回调无效。",
      );
    }
    const record = this.localIdentityCodes.get(codeInput);
    this.localIdentityCodes.delete(codeInput);
    if (!record || record.expiresAt <= this.clock.nowSeconds()) {
      throw new GatewayError(
        401,
        "invalid_identity_code",
        "本地登录回调已失效，请重新开始。",
      );
    }
    const account = await this.accounts.findById(record.accountId);
    if (!account) {
      throw new GatewayError(
        401,
        "invalid_identity_code",
        "本地登录回调已失效，请重新开始。",
      );
    }
    const publicAccount = toPublicAccount(account);
    return {
      account: publicAccount,
      accessToken: this.issueSession(publicAccount),
    };
  }

  async authenticate(token: string): Promise<AuthenticatedAccount> {
    const claims = this.verifySession(token);
    const account = await this.accounts.findById(claims.sub);
    if (!account || account.email !== claims.email) {
      throw new GatewayError(
        401,
        "invalid_session",
        "登录已失效，请重新登录。",
      );
    }
    return toPublicAccount(account);
  }

  revoke(token: string): void {
    const claims = this.verifySession(token);
    this.revokedSessionExpiries.set(claims.jti, claims.exp);
    this.pruneRevocations();
  }

  private issueSession(account: AuthenticatedAccount): string {
    const iat = this.clock.nowSeconds();
    const claims: SessionClaims = {
      sub: account.id,
      email: account.email,
      iat,
      exp: iat + this.sessionTtlSeconds,
      jti: randomUUID(),
      v: 1,
    };
    const encodedClaims = Buffer.from(JSON.stringify(claims)).toString(
      "base64url",
    );
    const signature = sign(encodedClaims, this.secret);
    return `${encodedClaims}.${signature}`;
  }

  private verifySession(token: string): SessionClaims {
    const [encodedClaims, encodedSignature, extra] = token.split(".");
    if (!encodedClaims || !encodedSignature || extra) {
      throw new GatewayError(
        401,
        "invalid_session",
        "登录已失效，请重新登录。",
      );
    }
    const expectedSignature = sign(encodedClaims, this.secret);
    const supplied = Buffer.from(encodedSignature);
    const expected = Buffer.from(expectedSignature);
    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    ) {
      throw new GatewayError(
        401,
        "invalid_session",
        "登录已失效，请重新登录。",
      );
    }

    let claims: SessionClaims;
    try {
      claims = JSON.parse(
        Buffer.from(encodedClaims, "base64url").toString("utf8"),
      ) as SessionClaims;
    } catch {
      throw new GatewayError(
        401,
        "invalid_session",
        "登录已失效，请重新登录。",
      );
    }
    if (
      claims.v !== 1 ||
      typeof claims.sub !== "string" ||
      typeof claims.email !== "string" ||
      typeof claims.jti !== "string" ||
      !Number.isInteger(claims.exp) ||
      claims.exp <= this.clock.nowSeconds() ||
      this.revokedSessionExpiries.has(claims.jti)
    ) {
      throw new GatewayError(
        401,
        "invalid_session",
        "登录已失效，请重新登录。",
      );
    }
    return claims;
  }

  private pruneRevocations(): void {
    const now = this.clock.nowSeconds();
    for (const [jti, expiry] of this.revokedSessionExpiries) {
      if (expiry <= now) this.revokedSessionExpiries.delete(jti);
    }
  }

  private pruneLocalIdentityCodes(): void {
    const now = this.clock.nowSeconds();
    for (const [code, record] of this.localIdentityCodes) {
      if (record.expiresAt <= now) this.localIdentityCodes.delete(code);
    }
  }
}

function normalizeEmail(value: unknown): string {
  if (typeof value !== "string") {
    throw new GatewayError(400, "invalid_email", "请输入有效邮箱地址。");
  }
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new GatewayError(400, "invalid_email", "请输入有效邮箱地址。");
  }
  return email;
}

function validatePassword(value: unknown): string {
  if (typeof value !== "string" || value.length < 12 || value.length > 256) {
    throw new GatewayError(
      400,
      "invalid_password",
      "密码长度必须为 12–256 个字符。",
    );
  }
  return value;
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("base64url");
  const derived = scryptSync(password, salt, 64).toString("base64url");
  return `${salt}.${derived}`;
}

function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, hash, extra] = storedHash.split(".");
  if (!salt || !hash || extra) return false;
  const actual = Buffer.from(
    scryptSync(password, salt, 64).toString("base64url"),
  );
  const expected = Buffer.from(hash);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function toPublicAccount(account: StoredAccount): AuthenticatedAccount {
  return { id: account.id, email: account.email };
}
