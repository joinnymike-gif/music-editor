import { describe, expect, it } from "vitest";
import {
  MemoryAccountStore,
  ProductAuthService,
  type AuthClock,
} from "./auth.js";

class FakeClock implements AuthClock {
  seconds = 1_700_000_000;

  nowSeconds(): number {
    return this.seconds;
  }
}

describe("ProductAuthService", () => {
  it("hashes a password, issues a bounded product session, and revokes it", async () => {
    const clock = new FakeClock();
    const service = new ProductAuthService(
      new MemoryAccountStore(),
      "a".repeat(32),
      600,
      clock,
    );
    const account = await service.register(
      "  Composer@Example.com ",
      "a secure password",
    );
    const token = await service.login(
      "composer@example.com",
      "a secure password",
    );

    await expect(service.authenticate(token)).resolves.toEqual(account);
    service.revoke(token);
    await expect(service.authenticate(token)).rejects.toMatchObject({
      code: "invalid_session",
      status: 401,
    });
  });

  it("rejects duplicate accounts and expired sessions without exposing password state", async () => {
    const clock = new FakeClock();
    const service = new ProductAuthService(
      new MemoryAccountStore(),
      "b".repeat(32),
      300,
      clock,
    );
    await service.register("composer@example.com", "a secure password");
    await expect(
      service.register("composer@example.com", "another secure password"),
    ).rejects.toMatchObject({ code: "account_exists", status: 409 });

    const token = await service.login(
      "composer@example.com",
      "a secure password",
    );
    clock.seconds += 301;
    await expect(service.authenticate(token)).rejects.toMatchObject({
      code: "invalid_session",
      status: 401,
    });
  });

  it("exchanges a local-demo identity code once and expires it", async () => {
    const clock = new FakeClock();
    const service = new ProductAuthService(
      new MemoryAccountStore(),
      "c".repeat(32),
      300,
      clock,
    );
    const code = await service.beginLocalMockIdentity("demo@local.test");
    const exchanged = await service.exchangeLocalMockIdentity(code);
    await expect(service.authenticate(exchanged.accessToken)).resolves.toEqual(
      exchanged.account,
    );
    await expect(service.exchangeLocalMockIdentity(code)).rejects.toMatchObject(
      {
        code: "invalid_identity_code",
        status: 401,
      },
    );
  });
});
