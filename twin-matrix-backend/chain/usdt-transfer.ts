import { Contract, Wallet, parseUnits } from "ethers";
import { getProvider, isChainEnabled } from "./client.js";

const ERC20_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
];

const SEND_TX_TIMEOUT_MS = 45_000;
const WAIT_RECEIPT_TIMEOUT_MS = 15_000;
const BROADCAST_CHECK_RETRIES = 5;
const BROADCAST_CHECK_INTERVAL_MS = 1_500;

type ReceiptLike = {
  hash?: string;
  status?: number | bigint | null;
} | null;

function getUsdtContractAddress(): string {
  const value = process.env.USDT_CONTRACT_ADDRESS?.trim();
  if (!value) {
    throw new Error("USDT_CONTRACT_ADDRESS is not set");
  }
  return value;
}

function getVendorPrivateKey(): string {
  const value = process.env.VENDOR_PRIVATE_KEY?.trim();
  if (!value) {
    throw new Error("VENDOR_PRIVATE_KEY is not set");
  }
  return value;
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function transferUsdt(params: {
  to: string;
  amountUsdt: number;
}): Promise<{ txHash: string; confirmed: boolean }> {
  if (!isChainEnabled()) {
    console.log(`[chain:mock] transferUsdt(to=${params.to}, amount=${params.amountUsdt})`);
    return { txHash: "0xmock_transfer_usdt", confirmed: true };
  }

  const signer = new Wallet(getVendorPrivateKey(), getProvider());
  const usdt = new Contract(getUsdtContractAddress(), ERC20_ABI, signer);
  const amount = parseUnits(String(params.amountUsdt), 18);
  const signerAddress = await signer.getAddress();
  const network = await signer.provider.getNetwork();
  const chainId = Number(network.chainId);
  if (chainId !== 97) {
    console.warn(`[usdt] unexpected chainId=${chainId}. Expected BNB Testnet chainId=97.`);
  }
  const nativeBalance = await signer.provider.getBalance(signerAddress);
  const nonce = await signer.provider.getTransactionCount(signerAddress, "pending");
  console.info(
    `[usdt] transfer prepare chainId=${chainId} from=${signerAddress} to=${params.to} amount=${params.amountUsdt} nativeBalanceWei=${nativeBalance.toString()} nonce=${nonce}`,
  );

  const tx = await withTimeout(
    usdt.transfer(params.to, amount),
    SEND_TX_TIMEOUT_MS,
    "usdt.transfer() submission",
  );
  console.info(`[usdt] transfer submitted hash=${tx.hash}`);

  // Quick sanity check: make sure RPC can see the submitted tx hash.
  let visibleTx = null;
  for (let i = 0; i < BROADCAST_CHECK_RETRIES; i += 1) {
    visibleTx = await signer.provider.getTransaction(tx.hash);
    if (visibleTx) break;
    await sleep(BROADCAST_CHECK_INTERVAL_MS);
  }
  if (!visibleTx) {
    console.warn(
      `[usdt] transfer broadcast_unconfirmed hash=${tx.hash} chainId=${chainId} rpcCouldNotFindTx=true`,
    );
  } else {
    console.info(
      `[usdt] transfer broadcast_ok hash=${tx.hash} chainId=${chainId} blockNumber=${visibleTx.blockNumber ?? "pending"} nonce=${visibleTx.nonce}`,
    );
  }

  try {
    const receipt = (await withTimeout(
      tx.wait(),
      WAIT_RECEIPT_TIMEOUT_MS,
      "tx.wait() confirmation",
    )) as ReceiptLike;
    console.info(
      `[usdt] transfer confirmed hash=${receipt?.hash ?? tx.hash} status=${receipt?.status ?? "unknown"}`,
    );
    return { txHash: receipt?.hash ?? tx.hash, confirmed: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("tx.wait() confirmation timed out")) {
      console.warn(`[usdt] transfer pending hash=${tx.hash} reason=${message}`);
      // Continue observing in background for troubleshooting without blocking response.
      void tx
        .wait()
        .then((receipt: ReceiptLike) => {
          console.info(
            `[usdt] transfer confirmed_late hash=${receipt?.hash ?? tx.hash} status=${receipt?.status ?? "unknown"}`,
          );
        })
        .catch((waitErr: unknown) => {
          console.warn(
            `[usdt] transfer wait_late_failed hash=${tx.hash} error=${
              waitErr instanceof Error ? waitErr.message : String(waitErr)
            }`,
          );
        });
      return { txHash: tx.hash, confirmed: false };
    }
    throw err;
  }
}
