import { Cl, ClarityType } from "@stacks/transactions";
import { describe, expect, it, beforeEach } from "vitest";

const accounts = simnet.getAccounts();
const deployer = accounts.get("deployer")!;
const wallet1 = accounts.get("wallet_1")!;
const wallet2 = accounts.get("wallet_2")!;

describe("Counter Functions Tests", () => {
  it("allows incrementing the counter", () => {
    const incrementResponse = simnet.callPublicFn(
      "vault",
      "increment",
      [],
      deployer
    );

    expect(incrementResponse.result).toBeOk(Cl.uint(1));
  });

  it("emits event when incrementing counter", () => {
    const currentBlock = simnet.blockHeight;
    const incrementResponse = simnet.callPublicFn(
      "vault",
      "increment",
      [],
      deployer
    );

    expect(incrementResponse.result).toBeOk(Cl.uint(1));

    // Check for print event
    const printEvents = incrementResponse.events.filter(
      (e) => e.event === "print_event"
    );
    expect(printEvents).toHaveLength(1);
    expect(printEvents[0].data.value).toStrictEqual(
      Cl.tuple({
        event: Cl.stringAscii("counter-incremented"),
        caller: Cl.principal(deployer),
        "new-value": Cl.uint(1),
        "block-height": Cl.uint(currentBlock),
      })
    );
  });

  it("allows multiple increments", () => {
    simnet.callPublicFn("vault", "increment", [], deployer);
    simnet.callPublicFn("vault", "increment", [], deployer);
    const incrementResponse = simnet.callPublicFn(
      "vault",
      "increment",
      [],
      deployer
    );

    expect(incrementResponse.result).toBeOk(Cl.uint(3));
  });

  it("allows decrementing the counter", () => {
    simnet.callPublicFn("vault", "increment", [], deployer);
    simnet.callPublicFn("vault", "increment", [], deployer);

    const decrementResponse = simnet.callPublicFn(
      "vault",
      "decrement",
      [],
      deployer
    );

    expect(decrementResponse.result).toBeOk(Cl.uint(1));
  });

  it("emits event when decrementing counter", () => {
    simnet.callPublicFn("vault", "increment", [], deployer);
    simnet.callPublicFn("vault", "increment", [], deployer);

    const decrementResponse = simnet.callPublicFn(
      "vault",
      "decrement",
      [],
      deployer
    );

    expect(decrementResponse.result).toBeOk(Cl.uint(1));

    // Check for print event
    const printEvents = decrementResponse.events.filter(
      (e) => e.event === "print_event"
    );
    expect(printEvents).toHaveLength(1);

    const eventData = printEvents[0].data.value as any;
    expect(eventData.value.event.value).toBe("counter-decremented");
    expect(eventData.value.caller.value).toBe(deployer);
    expect(eventData.value["new-value"].value).toBe(1n);
    expect(eventData.value["block-height"].type).toBe("uint");
  });

  it("prevents underflow when decrementing at zero", () => {
    const decrementResponse = simnet.callPublicFn(
      "vault",
      "decrement",
      [],
      deployer
    );

    // Should return ERR_UNDERFLOW (err u101)
    expect(decrementResponse.result).toBeErr(Cl.uint(101));
  });

  it("returns the current counter value", () => {
    simnet.callPublicFn("vault", "increment", [], deployer);
    simnet.callPublicFn("vault", "increment", [], deployer);

    const counterValue = simnet.callReadOnlyFn(
      "vault",
      "get-counter",
      [],
      deployer
    );

    expect(counterValue.result).toBeOk(Cl.uint(2));
  });
});

describe("Vault Deposit Tests", () => {
  it("allows a user to deposit STX with a future unlock block", () => {
    const amount = 1000;
    const currentBlock = simnet.blockHeight;
    const unlockBlock = currentBlock + 10;

    const depositResponse = simnet.callPublicFn(
      "vault",
      "deposit",
      [Cl.uint(amount), Cl.uint(unlockBlock)],
      wallet1
    );

    expect(depositResponse.result).toBeOk(Cl.bool(true));

    // Check STX transfer event
    const stxEvents = depositResponse.events.filter(
      (e) => e.event === "stx_transfer_event"
    );
    expect(stxEvents).toHaveLength(1);
    expect(stxEvents[0].data).toMatchObject({
      amount: amount.toString(),
      sender: wallet1,
      recipient: `${deployer}.vault`,
    });
  });

  it("emits event when depositing to vault", () => {
    const amount = 1000;
    const currentBlock = simnet.blockHeight;
    const unlockBlock = currentBlock + 10;

    const depositResponse = simnet.callPublicFn(
      "vault",
      "deposit",
      [Cl.uint(amount), Cl.uint(unlockBlock)],
      wallet1
    );

    expect(depositResponse.result).toBeOk(Cl.bool(true));

    // Check for print event
    const printEvents = depositResponse.events.filter(
      (e) => e.event === "print_event"
    );
    expect(printEvents).toHaveLength(1);
    expect(printEvents[0].data.value).toStrictEqual(
      Cl.tuple({
        event: Cl.stringAscii("deposit"),
        user: Cl.principal(wallet1),
        amount: Cl.uint(amount),
        "new-balance": Cl.uint(amount),
        "unlock-block": Cl.uint(unlockBlock),
        "current-block": Cl.uint(currentBlock),
      })
    );
  });

  it("rejects deposit with unlock block in the past", () => {
    const amount = 1000;
    const currentBlock = simnet.blockHeight;
    const unlockBlock = currentBlock - 1;

    const depositResponse = simnet.callPublicFn(
      "vault",
      "deposit",
      [Cl.uint(amount), Cl.uint(unlockBlock)],
      wallet1
    );

    // Should return ERR_INVALID_BLOCK (err u102)
    expect(depositResponse.result).toBeErr(Cl.uint(102));
    expect(depositResponse.events).toHaveLength(0);
  });

  it("rejects deposit with unlock block equal to current block", () => {
    const amount = 1000;
    const currentBlock = simnet.blockHeight;

    const depositResponse = simnet.callPublicFn(
      "vault",
      "deposit",
      [Cl.uint(amount), Cl.uint(currentBlock)],
      wallet1
    );

    // Should return ERR_INVALID_BLOCK (err u102)
    expect(depositResponse.result).toBeErr(Cl.uint(102));
  });

  it("allows multiple deposits from the same user", () => {
    const amount1 = 1000;
    const amount2 = 500;
    const currentBlock = simnet.blockHeight;
    const unlockBlock = currentBlock + 10;

    const depositResponse1 = simnet.callPublicFn(
      "vault",
      "deposit",
      [Cl.uint(amount1), Cl.uint(unlockBlock)],
      wallet1
    );

    const depositResponse2 = simnet.callPublicFn(
      "vault",
      "deposit",
      [Cl.uint(amount2), Cl.uint(unlockBlock + 5)],
      wallet1
    );

    expect(depositResponse1.result).toBeOk(Cl.bool(true));
    expect(depositResponse2.result).toBeOk(Cl.bool(true));

    // Check vault info shows combined balance
    const vaultInfo = simnet.callReadOnlyFn(
      "vault",
      "get-vault-info",
      [Cl.principal(wallet1)],
      wallet1
    );

    expect(vaultInfo.result).toBeOk(
      Cl.tuple({
        balance: Cl.uint(amount1 + amount2),
        "unlock-block": Cl.uint(unlockBlock + 5),
      })
    );
  });

  it("emits correct event for multiple deposits with updated balance", () => {
    const amount1 = 1000;
    const amount2 = 500;
    const currentBlock = simnet.blockHeight;
    const unlockBlock = currentBlock + 10;

    // First deposit
    simnet.callPublicFn(
      "vault",
      "deposit",
      [Cl.uint(amount1), Cl.uint(unlockBlock)],
      wallet1
    );

    // Second deposit - get current block before the transaction
    const depositResponse2 = simnet.callPublicFn(
      "vault",
      "deposit",
      [Cl.uint(amount2), Cl.uint(unlockBlock + 5)],
      wallet1
    );

    // Check second deposit emits event with accumulated balance
    const printEvents = depositResponse2.events.filter(
      (e) => e.event === "print_event"
    );
    expect(printEvents).toHaveLength(1);
    expect(printEvents[0].data.value).toStrictEqual(
      Cl.tuple({
        event: Cl.stringAscii("deposit"),
        user: Cl.principal(wallet1),
        amount: Cl.uint(amount2),
        "new-balance": Cl.uint(amount1 + amount2),
        "unlock-block": Cl.uint(unlockBlock + 5),
        "current-block": Cl.uint(currentBlock),
      })
    );
  });

  it("updates unlock block to later date on subsequent deposits", () => {
    const amount = 1000;
    const currentBlock = simnet.blockHeight;
    const unlockBlock1 = currentBlock + 10;
    const unlockBlock2 = currentBlock + 20;

    simnet.callPublicFn(
      "vault",
      "deposit",
      [Cl.uint(amount), Cl.uint(unlockBlock1)],
      wallet1
    );

    simnet.callPublicFn(
      "vault",
      "deposit",
      [Cl.uint(amount), Cl.uint(unlockBlock2)],
      wallet1
    );

    const vaultInfo = simnet.callReadOnlyFn(
      "vault",
      "get-vault-info",
      [Cl.principal(wallet1)],
      wallet1
    );

    expect(vaultInfo.result).toBeOk(
      Cl.tuple({
        balance: Cl.uint(amount * 2),
        "unlock-block": Cl.uint(unlockBlock2),
      })
    );
  });

  it("maintains unlock block when subsequent deposit has earlier unlock", () => {
    const amount = 1000;
    const currentBlock = simnet.blockHeight;
    const unlockBlock1 = currentBlock + 20;
    const unlockBlock2 = currentBlock + 10;

    simnet.callPublicFn(
      "vault",
      "deposit",
      [Cl.uint(amount), Cl.uint(unlockBlock1)],
      wallet1
    );

    simnet.callPublicFn(
      "vault",
      "deposit",
      [Cl.uint(amount), Cl.uint(unlockBlock2)],
      wallet1
    );

    const vaultInfo = simnet.callReadOnlyFn(
      "vault",
      "get-vault-info",
      [Cl.principal(wallet1)],
      wallet1
    );

    // Unlock block should remain at the later block
    expect(vaultInfo.result).toBeOk(
      Cl.tuple({
        balance: Cl.uint(amount * 2),
        "unlock-block": Cl.uint(unlockBlock1),
      })
    );
  });

  it("allows different users to have separate vaults", () => {
    const amount = 1000;
    const currentBlock = simnet.blockHeight;
    const unlockBlock = currentBlock + 10;

    simnet.callPublicFn(
      "vault",
      "deposit",
      [Cl.uint(amount), Cl.uint(unlockBlock)],
      wallet1
    );

    simnet.callPublicFn(
      "vault",
      "deposit",
      [Cl.uint(amount * 2), Cl.uint(unlockBlock + 5)],
      wallet2
    );

    const vaultInfo1 = simnet.callReadOnlyFn(
      "vault",
      "get-vault-info",
      [Cl.principal(wallet1)],
      wallet1
    );

    const vaultInfo2 = simnet.callReadOnlyFn(
      "vault",
      "get-vault-info",
      [Cl.principal(wallet2)],
      wallet2
    );

    expect(vaultInfo1.result).toBeOk(
      Cl.tuple({
        balance: Cl.uint(amount),
        "unlock-block": Cl.uint(unlockBlock),
      })
    );

    expect(vaultInfo2.result).toBeOk(
      Cl.tuple({
        balance: Cl.uint(amount * 2),
        "unlock-block": Cl.uint(unlockBlock + 5),
      })
    );
  });
});

describe("Vault Withdrawal Tests", () => {
  it("allows withdrawal after unlock block is reached", () => {
    const amount = 1000;
    const currentBlock = simnet.blockHeight;
    const unlockBlock = currentBlock + 10;

    simnet.callPublicFn(
      "vault",
      "deposit",
      [Cl.uint(amount), Cl.uint(unlockBlock)],
      wallet1
    );

    // Advance to unlock block
    simnet.mineEmptyBlocks(10);

    const withdrawResponse = simnet.callPublicFn(
      "vault",
      "withdraw",
      [],
      wallet1
    );

    expect(withdrawResponse.result).toBeOk(Cl.uint(amount));

    // Check STX transfer event
    const stxEvents = withdrawResponse.events.filter(
      (e) => e.event === "stx_transfer_event"
    );
    expect(stxEvents).toHaveLength(1);
    expect(stxEvents[0].data).toMatchObject({
      amount: amount.toString(),
      sender: `${deployer}.vault`,
      recipient: wallet1,
    });
  });

  it("emits event when withdrawing from vault", () => {
    const amount = 1000;
    const currentBlock = simnet.blockHeight;
    const unlockBlock = currentBlock + 10;

    simnet.callPublicFn(
      "vault",
      "deposit",
      [Cl.uint(amount), Cl.uint(unlockBlock)],
      wallet1
    );

    // Advance to unlock block
    simnet.mineEmptyBlocks(10);

    const withdrawResponse = simnet.callPublicFn(
      "vault",
      "withdraw",
      [],
      wallet1
    );

    expect(withdrawResponse.result).toBeOk(Cl.uint(amount));

    // Check for print event
    const printEvents = withdrawResponse.events.filter(
      (e) => e.event === "print_event"
    );
    expect(printEvents).toHaveLength(1);
    expect(printEvents[0].data.value).toStrictEqual(
      Cl.tuple({
        event: Cl.stringAscii("withdraw"),
        user: Cl.principal(wallet1),
        amount: Cl.uint(amount),
        "unlock-block": Cl.uint(unlockBlock),
        "current-block": Cl.uint(currentBlock + 10),
      })
    );
  });

  it("prevents withdrawal before unlock block is reached", () => {
    const amount = 1000;
    const currentBlock = simnet.blockHeight;
    const unlockBlock = currentBlock + 10;

    simnet.callPublicFn(
      "vault",
      "deposit",
      [Cl.uint(amount), Cl.uint(unlockBlock)],
      wallet1
    );

    // Advance but not enough
    simnet.mineEmptyBlocks(5);

    const withdrawResponse = simnet.callPublicFn(
      "vault",
      "withdraw",
      [],
      wallet1
    );

    // Should return ERR_TOO_EARLY (err u103)
    expect(withdrawResponse.result).toBeErr(Cl.uint(103));
    expect(withdrawResponse.events).toHaveLength(0);
  });

  it("prevents withdrawal when user has no funds", () => {
    const withdrawResponse = simnet.callPublicFn(
      "vault",
      "withdraw",
      [],
      wallet1
    );

    // Should return ERR_NO_FUNDS (err u104)
    expect(withdrawResponse.result).toBeErr(Cl.uint(104));
  });

  it("clears vault data after successful withdrawal", () => {
    const amount = 1000;
    const currentBlock = simnet.blockHeight;
    const unlockBlock = currentBlock + 10;

    simnet.callPublicFn(
      "vault",
      "deposit",
      [Cl.uint(amount), Cl.uint(unlockBlock)],
      wallet1
    );

    simnet.mineEmptyBlocks(10);

    simnet.callPublicFn("vault", "withdraw", [], wallet1);

    const vaultInfo = simnet.callReadOnlyFn(
      "vault",
      "get-vault-info",
      [Cl.principal(wallet1)],
      wallet1
    );

    expect(vaultInfo.result).toBeOk(
      Cl.tuple({
        balance: Cl.uint(0),
        "unlock-block": Cl.uint(0),
      })
    );
  });

  it("allows withdrawal exactly at unlock block", () => {
    const amount = 1000;
    const currentBlock = simnet.blockHeight;
    const unlockBlock = currentBlock + 10;

    simnet.callPublicFn(
      "vault",
      "deposit",
      [Cl.uint(amount), Cl.uint(unlockBlock)],
      wallet1
    );

    // Advance exactly to unlock block
    simnet.mineEmptyBlocks(10);

    const withdrawResponse = simnet.callPublicFn(
      "vault",
      "withdraw",
      [],
      wallet1
    );

    expect(withdrawResponse.result).toBeOk(Cl.uint(amount));
  });

  it("prevents withdrawal of another user's funds", () => {
    const amount = 1000;
    const currentBlock = simnet.blockHeight;
    const unlockBlock = currentBlock + 10;

    simnet.callPublicFn(
      "vault",
      "deposit",
      [Cl.uint(amount), Cl.uint(unlockBlock)],
      wallet1
    );

    simnet.mineEmptyBlocks(10);

    const withdrawResponse = simnet.callPublicFn(
      "vault",
      "withdraw",
      [],
      wallet2
    );

    // Should return ERR_NO_FUNDS (err u104)
    expect(withdrawResponse.result).toBeErr(Cl.uint(104));
  });

  it("allows redeposit after withdrawal", () => {
    const amount1 = 1000;
    const amount2 = 500;
    const currentBlock = simnet.blockHeight;
    const unlockBlock1 = currentBlock + 10;

    // First deposit and withdrawal
    simnet.callPublicFn(
      "vault",
      "deposit",
      [Cl.uint(amount1), Cl.uint(unlockBlock1)],
      wallet1
    );

    simnet.mineEmptyBlocks(10);
    simnet.callPublicFn("vault", "withdraw", [], wallet1);

    // Second deposit
    const currentBlock2 = simnet.blockHeight;
    const unlockBlock2 = currentBlock2 + 5;

    const depositResponse2 = simnet.callPublicFn(
      "vault",
      "deposit",
      [Cl.uint(amount2), Cl.uint(unlockBlock2)],
      wallet1
    );

    expect(depositResponse2.result).toBeOk(Cl.bool(true));

    const vaultInfo = simnet.callReadOnlyFn(
      "vault",
      "get-vault-info",
      [Cl.principal(wallet1)],
      wallet1
    );

    expect(vaultInfo.result).toBeOk(
      Cl.tuple({
        balance: Cl.uint(amount2),
        "unlock-block": Cl.uint(unlockBlock2),
      })
    );
  });
});

describe("Read-Only Function Tests", () => {
  it("returns current block height", () => {
    const currentBlock = simnet.blockHeight;

    const blockHeightResponse = simnet.callReadOnlyFn(
      "vault",
      "get-current-block",
      [],
      deployer
    );

    expect(blockHeightResponse.result).toBeOk(Cl.uint(currentBlock));
  });

  it("returns zero balance for user with no vault", () => {
    const vaultInfo = simnet.callReadOnlyFn(
      "vault",
      "get-vault-info",
      [Cl.principal(wallet1)],
      wallet1
    );

    expect(vaultInfo.result).toBeOk(
      Cl.tuple({
        balance: Cl.uint(0),
        "unlock-block": Cl.uint(0),
      })
    );
  });

  it("returns correct vault info for deposited user", () => {
    const amount = 1000;
    const currentBlock = simnet.blockHeight;
    const unlockBlock = currentBlock + 10;

    simnet.callPublicFn(
      "vault",
      "deposit",
      [Cl.uint(amount), Cl.uint(unlockBlock)],
      wallet1
    );

    const vaultInfo = simnet.callReadOnlyFn(
      "vault",
      "get-vault-info",
      [Cl.principal(wallet1)],
      wallet1
    );

    expect(vaultInfo.result).toBeOk(
      Cl.tuple({
        balance: Cl.uint(amount),
        "unlock-block": Cl.uint(unlockBlock),
      })
    );
  });
});

describe("Integration Tests", () => {
  it("handles complete deposit-withdraw cycle for multiple users", () => {
    const amount1 = 1000;
    const amount2 = 2000;
    const currentBlock = simnet.blockHeight;
    const unlockBlock1 = currentBlock + 5;
    const unlockBlock2 = currentBlock + 10;

    // User 1 deposits
    simnet.callPublicFn(
      "vault",
      "deposit",
      [Cl.uint(amount1), Cl.uint(unlockBlock1)],
      wallet1
    );

    // User 2 deposits
    simnet.callPublicFn(
      "vault",
      "deposit",
      [Cl.uint(amount2), Cl.uint(unlockBlock2)],
      wallet2
    );

    // Advance to user 1's unlock block
    simnet.mineEmptyBlocks(5);

    // User 1 can withdraw
    const withdraw1 = simnet.callPublicFn("vault", "withdraw", [], wallet1);
    expect(withdraw1.result).toBeOk(Cl.uint(amount1));

    // User 2 cannot withdraw yet
    const withdraw2Early = simnet.callPublicFn(
      "vault",
      "withdraw",
      [],
      wallet2
    );
    expect(withdraw2Early.result).toBeErr(Cl.uint(103));

    // Advance to user 2's unlock block
    simnet.mineEmptyBlocks(5);

    // User 2 can now withdraw
    const withdraw2 = simnet.callPublicFn("vault", "withdraw", [], wallet2);
    expect(withdraw2.result).toBeOk(Cl.uint(amount2));
  });

  it("handles multiple deposits and single withdrawal", () => {
    const amount = 500;
    const currentBlock = simnet.blockHeight;
    const unlockBlock = currentBlock + 10;

    // Multiple deposits
    simnet.callPublicFn(
      "vault",
      "deposit",
      [Cl.uint(amount), Cl.uint(unlockBlock)],
      wallet1
    );

    simnet.callPublicFn(
      "vault",
      "deposit",
      [Cl.uint(amount), Cl.uint(unlockBlock)],
      wallet1
    );

    simnet.callPublicFn(
      "vault",
      "deposit",
      [Cl.uint(amount), Cl.uint(unlockBlock)],
      wallet1
    );

    simnet.mineEmptyBlocks(10);

    // Single withdrawal gets all funds
    const withdrawResponse = simnet.callPublicFn(
      "vault",
      "withdraw",
      [],
      wallet1
    );

    expect(withdrawResponse.result).toBeOk(Cl.uint(amount * 3));
  });
});
