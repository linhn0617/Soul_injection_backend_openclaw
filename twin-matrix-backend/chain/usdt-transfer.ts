import { Contract, Wallet, parseUnits } from "ethers";
import { getProvider, isChainEnabled } from "./client.js";

const ERC20_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
];

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

export async function transferUsdt(params: {
  to: string;
  amountUsdt: number;
}): Promise<{ txHash: string }> {
  if (!isChainEnabled()) {
    console.log(`[chain:mock] transferUsdt(to=${params.to}, amount=${params.amountUsdt})`);
    return { txHash: "0xmock_transfer_usdt" };
  }

  const signer = new Wallet(getVendorPrivateKey(), getProvider());
  const usdt = new Contract(getUsdtContractAddress(), ERC20_ABI, signer);
  const amount = parseUnits(String(params.amountUsdt), 18);
  const tx = await usdt.transfer(params.to, amount);
  const receipt = await tx.wait();
  return { txHash: receipt?.hash ?? tx.hash };
}

