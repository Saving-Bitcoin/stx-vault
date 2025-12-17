/**
 * Vault driver script
 *      -- run the script with --
 *  npx tsx x-temp/vault-driver.ts
 *
 * or with options:
 *
 *  npx tsx x-temp/vault-driver.ts --fast (ignores the delay time set)
 *  npx tsx x-temp/vault-driver.ts --mode=counter (test counter increment)
 *  npx tsx x-temp/vault-driver.ts --mode=decrement (test counter decrement)
 *  npx tsx x-temp/vault-driver.ts --mode=deposit (test vault deposit - 0.0001 STX each)
 *  npx tsx x-temp/vault-driver.ts --mode=full (test counter, deposit, and info)
 *
 * - Reads the deployer "mnemonic" from settings/Mainnet.toml
 * - Derives the account private key
 * - Interacts with the deployed mainnet contract:
 *     SP1WEKNK5SGNTYM0J8M34FMBM7PTRJSYRWY9C1CGR.vault
 * - Modes:
 *     counter: Continuously calls increment with random delays
 *     decrement: Continuously calls decrement with random delays
 *     deposit: Makes test deposits to the vault
 *     full: Runs counter increments and checks vault info periodically
 * - Waits a random interval between each call:
 *     30s, 45s, 1m, 1m15s, 1m30s, 1m45s, 3m
 *
 * Usage:
 *   - Ensure you have installed dependencies in stx-vault/: npm install
 *   - Run with tsx
 *   - By default, this script resolves settings/Mainnet.toml relative to this file
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createNetwork, TransactionVersion } from "@stacks/network";
import {
  AnchorMode,
  PostConditionMode,
  makeContractCall,
  broadcastTransaction,
  fetchCallReadOnlyFunction,
  cvToString,
  uintCV,
  principalCV,
} from "@stacks/transactions";
import { generateWallet, getStxAddress } from "@stacks/wallet-sdk";
import * as TOML from "toml";

type NetworkSettings = {
  network?: {
    name?: string;
    stacks_node_rpc_address?: string;
    deployment_fee_rate?: number;
  };
  accounts?: {
    deployer?: {
      mnemonic?: string;
    };
  };
};

const CONTRACT_ADDRESS = "SP1WEKNK5SGNTYM0J8M34FMBM7PTRJSYRWY9C1CGR";
const CONTRACT_NAME = "vault";

// Function names in vault.clar
const FN_INCREMENT = "increment";
const FN_DECREMENT = "decrement";
const FN_DEPOSIT = "deposit";
const FN_WITHDRAW = "withdraw";
const FN_GET_COUNTER = "get-counter";
const FN_GET_VAULT_INFO = "get-vault-info";
const FN_GET_CURRENT_BLOCK = "get-current-block";

// Reasonable default fee in microstacks for contract-call
const DEFAULT_FEE_USTX = 10000;

// Parse command-line arguments
const FAST = process.argv.includes("--fast");
const MODE =
  process.argv.find((arg) => arg.startsWith("--mode="))?.split("=")[1] ||
  "counter";

// Random delay choices (milliseconds)
let DELAY_CHOICES_MS = [
  30_000, // 30 sec
  60_000, // 1 min
  45_000, // 45 sec
  105_000, // 1 min 45 sec
  75_000, // 1 min 15 sec
  90_000, // 1 min 30 sec
  180_000, // 3 min
];
if (FAST) {
  // Shorten delays for a quick smoke run
  DELAY_CHOICES_MS = [1_000, 2_000, 3_000, 5_000];
}

// Helper to get current file dir (ESM-compatible)
function thisDirname(): string {
  const __filename = fileURLToPath(import.meta.url);
  return path.dirname(__filename);
}

async function readMainnetMnemonic(): Promise<string> {
  const baseDir = thisDirname();
  // Resolve ../settings/Mainnet.toml relative to this file
  const settingsPath = path.resolve(baseDir, "../settings/Mainnet.toml");

  const raw = await fs.readFile(settingsPath, "utf8");
  const parsed = TOML.parse(raw) as NetworkSettings;

  const mnemonic = parsed?.accounts?.deployer?.mnemonic;
  if (!mnemonic || mnemonic.includes("<YOUR PRIVATE MAINNET MNEMONIC HERE>")) {
    throw new Error(
      `Mnemonic not found in ${settingsPath}. Please set [accounts.deployer].mnemonic.`
    );
  }
  return mnemonic.trim();
}

async function deriveSenderFromMnemonic(mnemonic: string) {
  // Note: generateWallet accepts the 12/24-word secret phrase via "secretKey"
  const wallet = await generateWallet({
    secretKey: mnemonic,
    password: "",
  });
  const account = wallet.accounts[0];

  function normalizeSenderKey(key: string): string {
    let k = (key || "").trim();
    if (k.startsWith("0x") || k.startsWith("0X")) k = k.slice(2);
    return k;
  }

  const rawKey = account.stxPrivateKey || "";
  const senderKey = normalizeSenderKey(rawKey); // hex private key string, no 0x prefix

  const senderAddress = getStxAddress({
    account,
    transactionVersion: TransactionVersion.Mainnet,
  });

  // Debug: key length (do not print full key)
  console.log(
    `Derived sender key length: ${senderKey.length} hex chars (address: ${senderAddress})`
  );

  return { senderKey, senderAddress };
}

function pickRandomDelayMs(): number {
  const i = Math.floor(Math.random() * DELAY_CHOICES_MS.length);
  return DELAY_CHOICES_MS[i];
}

function delay(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    if (signal?.aborted) {
      clearTimeout(timer);
      return reject(new Error("aborted"));
    }
    signal?.addEventListener("abort", onAbort);
  });
}

async function readCounter(network: any, senderAddress: string) {
  const res = await fetchCallReadOnlyFunction({
    contractAddress: CONTRACT_ADDRESS,
    contractName: CONTRACT_NAME,
    functionName: FN_GET_COUNTER,
    functionArgs: [],
    network,
    senderAddress,
  });
  return cvToString(res);
}

async function readVaultInfo(
  network: any,
  senderAddress: string,
  userAddress: string
) {
  const res = await fetchCallReadOnlyFunction({
    contractAddress: CONTRACT_ADDRESS,
    contractName: CONTRACT_NAME,
    functionName: FN_GET_VAULT_INFO,
    functionArgs: [principalCV(userAddress)],
    network,
    senderAddress,
  });
  return cvToString(res);
}

async function readCurrentBlock(network: any, senderAddress: string) {
  const res = await fetchCallReadOnlyFunction({
    contractAddress: CONTRACT_ADDRESS,
    contractName: CONTRACT_NAME,
    functionName: FN_GET_CURRENT_BLOCK,
    functionArgs: [],
    network,
    senderAddress,
  });
  return cvToString(res);
}

async function contractCall(
  network: any,
  senderKey: string,
  functionName: string,
  functionArgs: any[] = []
) {
  console.log(
    `Preparing contract-call tx for: ${functionName}${
      functionArgs.length > 0 ? " with args" : ""
    }`
  );
  const tx = await makeContractCall({
    contractAddress: CONTRACT_ADDRESS,
    contractName: CONTRACT_NAME,
    functionName,
    functionArgs,
    network,
    senderKey,
    fee: DEFAULT_FEE_USTX,
    anchorMode: AnchorMode.Any,
    postConditionMode: PostConditionMode.Allow,
  });

  // Defensive: ensure tx object is valid before broadcast
  if (!tx || typeof (tx as any).serialize !== "function") {
    throw new Error(
      `Invalid transaction object for ${functionName} (missing serialize).`
    );
  }

  try {
    const resp = await broadcastTransaction({ transaction: tx, network });
    const txid =
      typeof resp === "string"
        ? resp
        : (resp as any).txid ||
          (resp as any).transactionId ||
          (resp as any).txId ||
          (resp as any).tx_id ||
          "unknown-txid";
    console.log(`Broadcast response for ${functionName}: ${txid}`);
    return txid;
  } catch (e: any) {
    const reason =
      e?.message ||
      e?.response?.error ||
      e?.response?.reason ||
      e?.responseText ||
      "unknown-error";
    throw new Error(`Broadcast failed for ${functionName}: ${reason}`);
  }
}

async function runCounterMode(
  network: any,
  senderKey: string,
  senderAddress: string,
  stopSignal: AbortSignal
) {
  console.log("Running in COUNTER mode: will increment counter continuously");
  let keepRunning = true;
  let iteration = 0;

  stopSignal.addEventListener("abort", () => {
    keepRunning = false;
  });

  while (keepRunning) {
    iteration++;
    const functionName = FN_INCREMENT;

    const waitMs = pickRandomDelayMs();
    const seconds = Math.round(waitMs / 1000);
    console.log(`Waiting ~${seconds}s before next call (${functionName})...`);
    try {
      await delay(waitMs, stopSignal);
    } catch {
      break;
    }

    console.log(`Calling ${functionName} (#${iteration})...`);
    let txid: string | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        txid = await contractCall(network, senderKey, functionName);
        console.log(`Broadcasted ${functionName}: ${txid}`);
        break;
      } catch (err) {
        const msg = (err as Error).message || String(err);
        console.warn(
          `Attempt ${attempt} failed for ${functionName}: ${msg}${
            attempt < 3 ? " — retrying..." : ""
          }`
        );
        if (attempt < 3) {
          try {
            await delay(2000 * attempt, stopSignal);
          } catch {
            keepRunning = false;
            break;
          }
        }
      }
    }

    if (txid) {
      try {
        const current = await readCounter(network, senderAddress);
        console.log(`Current counter (read-only): ${current}`);
      } catch (re) {
        console.warn(
          `Warning: failed to read counter after ${functionName}:`,
          (re as Error).message
        );
      }
    }
  }
}

async function runDecrementMode(
  network: any,
  senderKey: string,
  senderAddress: string,
  stopSignal: AbortSignal
) {
  console.log("Running in DECREMENT mode: will decrement counter continuously");
  let keepRunning = true;
  let iteration = 0;

  stopSignal.addEventListener("abort", () => {
    keepRunning = false;
  });

  while (keepRunning) {
    iteration++;
    const functionName = FN_DECREMENT;

    const waitMs = pickRandomDelayMs();
    const seconds = Math.round(waitMs / 1000);
    console.log(`Waiting ~${seconds}s before next call (${functionName})...`);
    try {
      await delay(waitMs, stopSignal);
    } catch {
      break;
    }

    console.log(`Calling ${functionName} (#${iteration})...`);
    let txid: string | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        txid = await contractCall(network, senderKey, functionName);
        console.log(`Broadcasted ${functionName}: ${txid}`);
        break;
      } catch (err) {
        const msg = (err as Error).message || String(err);
        console.warn(
          `Attempt ${attempt} failed for ${functionName}: ${msg}${
            attempt < 3 ? " — retrying..." : ""
          }`
        );
        if (attempt < 3) {
          try {
            await delay(2000 * attempt, stopSignal);
          } catch {
            keepRunning = false;
            break;
          }
        }
      }
    }

    if (txid) {
      try {
        const current = await readCounter(network, senderAddress);
        console.log(`Current counter (read-only): ${current}`);
      } catch (re) {
        console.warn(
          `Warning: failed to read counter after ${functionName}:`,
          (re as Error).message
        );
      }
    }
  }
}

async function runDepositMode(
  network: any,
  senderKey: string,
  senderAddress: string,
  stopSignal: AbortSignal
) {
  console.log(
    "Running in DEPOSIT mode: will make test deposits of 0.0001 STX to vault"
  );
  let keepRunning = true;
  let iteration = 0;

  stopSignal.addEventListener("abort", () => {
    keepRunning = false;
  });

  while (keepRunning) {
    iteration++;

    const waitMs = pickRandomDelayMs();
    const seconds = Math.round(waitMs / 1000);
    console.log(`Waiting ~${seconds}s before next deposit...`);
    try {
      await delay(waitMs, stopSignal);
    } catch {
      break;
    }

    // Get current block
    let currentBlock = 0;
    try {
      const blockStr = await readCurrentBlock(network, senderAddress);
      currentBlock = parseInt(blockStr.replace(/[^0-9]/g, "")) || 0;
      console.log(`Current block: ${currentBlock}`);
    } catch (e) {
      console.warn("Warning: could not read current block, using estimate");
      currentBlock = 100000; // fallback estimate
    }

    // Deposit 100 uSTX (0.0001 STX) locked for ~10 blocks
    const depositAmount = 100; // 0.0001 STX in microstacks
    const unlockBlock = currentBlock + 10; // Lock for 10 blocks

    console.log(
      `Calling deposit (#${iteration}) with ${depositAmount} uSTX, unlock at block ${unlockBlock}...`
    );
    let txid: string | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        txid = await contractCall(network, senderKey, FN_DEPOSIT, [
          uintCV(depositAmount),
          uintCV(unlockBlock),
        ]);
        console.log(`Broadcasted deposit: ${txid}`);
        break;
      } catch (err) {
        const msg = (err as Error).message || String(err);
        console.warn(
          `Attempt ${attempt} failed for deposit: ${msg}${
            attempt < 3 ? " — retrying..." : ""
          }`
        );
        if (attempt < 3) {
          try {
            await delay(2000 * attempt, stopSignal);
          } catch {
            keepRunning = false;
            break;
          }
        }
      }
    }

    if (txid) {
      try {
        const vaultInfo = await readVaultInfo(
          network,
          senderAddress,
          senderAddress
        );
        console.log(`Vault info after deposit (read-only): ${vaultInfo}`);
      } catch (re) {
        console.warn(
          "Warning: failed to read vault info after deposit:",
          (re as Error).message
        );
      }
    }
  }
}

async function runFullMode(
  network: any,
  senderKey: string,
  senderAddress: string,
  stopSignal: AbortSignal
) {
  console.log(
    "Running in FULL mode: will increment counter and check vault info periodically"
  );
  let keepRunning = true;
  let iteration = 0;

  stopSignal.addEventListener("abort", () => {
    keepRunning = false;
  });

  while (keepRunning) {
    iteration++;

    const waitMs = pickRandomDelayMs();
    const seconds = Math.round(waitMs / 1000);
    console.log(`Waiting ~${seconds}s before next action...`);
    try {
      await delay(waitMs, stopSignal);
    } catch {
      break;
    }

    // Alternate between counter increment and vault info check
    if (iteration % 2 === 1) {
      // Increment counter
      console.log(`Calling ${FN_INCREMENT} (#${iteration})...`);
      let txid: string | null = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          txid = await contractCall(network, senderKey, FN_INCREMENT);
          console.log(`Broadcasted ${FN_INCREMENT}: ${txid}`);
          break;
        } catch (err) {
          const msg = (err as Error).message || String(err);
          console.warn(
            `Attempt ${attempt} failed for ${FN_INCREMENT}: ${msg}${
              attempt < 3 ? " — retrying..." : ""
            }`
          );
          if (attempt < 3) {
            try {
              await delay(2000 * attempt, stopSignal);
            } catch {
              keepRunning = false;
              break;
            }
          }
        }
      }

      if (txid) {
        try {
          const current = await readCounter(network, senderAddress);
          console.log(`Current counter (read-only): ${current}`);
        } catch (re) {
          console.warn(
            `Warning: failed to read counter:`,
            (re as Error).message
          );
        }
      }
    } else {
      // Check vault info and current block
      try {
        const currentBlock = await readCurrentBlock(network, senderAddress);
        const vaultInfo = await readVaultInfo(
          network,
          senderAddress,
          senderAddress
        );
        console.log(`Current block (read-only): ${currentBlock}`);
        console.log(`Vault info (read-only): ${vaultInfo}`);
      } catch (e) {
        console.warn(
          "Warning: failed to read vault info or current block:",
          (e as Error).message
        );
      }
    }
  }
}

async function main() {
  console.log("Vault driver starting...");
  if (FAST) console.log("FAST mode enabled: shortened delays");
  console.log(`Mode: ${MODE}`);

  // 1) Network
  const network = createNetwork("mainnet");

  // 2) Load mnemonic and derive sender
  const mnemonic = await readMainnetMnemonic();
  const { senderKey, senderAddress } = await deriveSenderFromMnemonic(mnemonic);

  console.log(`Using sender address: ${senderAddress}`);
  console.log(
    `Target contract: ${CONTRACT_ADDRESS}.${CONTRACT_NAME} (mainnet)`
  );

  // 3) Continuous run based on mode
  const stopController = new AbortController();
  const stopSignal = stopController.signal;
  process.on("SIGINT", () => {
    console.log("\nReceived SIGINT. Stopping now...");
    stopController.abort();
  });

  try {
    if (MODE === "counter") {
      await runCounterMode(network, senderKey, senderAddress, stopSignal);
    } else if (MODE === "decrement") {
      await runDecrementMode(network, senderKey, senderAddress, stopSignal);
    } else if (MODE === "deposit") {
      await runDepositMode(network, senderKey, senderAddress, stopSignal);
    } else if (MODE === "full") {
      await runFullMode(network, senderKey, senderAddress, stopSignal);
    } else {
      throw new Error(
        `Unknown mode: ${MODE}. Use --mode=counter, --mode=decrement, --mode=deposit, or --mode=full`
      );
    }
  } catch (e) {
    if ((e as Error).message !== "aborted") {
      throw e;
    }
  }

  // Final status check
  try {
    const finalCounter = await readCounter(network, senderAddress);
    const finalBlock = await readCurrentBlock(network, senderAddress);
    const finalVault = await readVaultInfo(
      network,
      senderAddress,
      senderAddress
    );
    console.log(`\nFinal status:`);
    console.log(`  Counter: ${finalCounter}`);
    console.log(`  Current block: ${finalBlock}`);
    console.log(`  Vault info: ${finalVault}`);
  } catch (e) {
    console.warn("Warning: failed to read final status:", (e as Error).message);
  }
  console.log("Vault driver stopped.");
}

// Run
main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
