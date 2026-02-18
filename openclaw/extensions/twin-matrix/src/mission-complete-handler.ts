import { getActiveAgentId } from "./active-map.js";
import { getBackendUrl } from "./runtime.js";

type CompleteResponse = {
  ok: boolean;
  text?: string;
  successText?: string;
  txHash?: string;
  transferConfirmed?: boolean;
  error?: string;
};

type SendFollowUp = (text: string) => Promise<void>;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function handleMissionComplete(params: {
  senderId: string | undefined;
  sendFollowUp?: SendFollowUp;
}): Promise<{ text: string }> {
  const { senderId, sendFollowUp } = params;
  if (!senderId) {
    return { text: "Unable to identify your Telegram account. Please try again." };
  }

  const agentId = await getActiveAgentId(senderId);
  if (!agentId) {
    return { text: "No active agent found. Please click the activation link first." };
  }

  const res = await fetch(`${getBackendUrl()}/v1/mission/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agentId }),
  });
  if (!res.ok) {
    const err = await res.text();
    if (sendFollowUp) {
      await sendFollowUp(`❌ Transfer failed.\n${err}`);
    }
    return { text: `❌ Failed to complete mission (${res.status}): ${err}` };
  }

  const payload = (await res.json()) as CompleteResponse;
  if (!payload.ok) {
    return { text: `❌ Failed to complete mission: ${payload.error ?? "unknown error"}` };
  }

  if (sendFollowUp) {
    await sleep(1000);
    await sendFollowUp("Mission approved. USDT transfer is now processing.");
    const suffix = payload.txHash ? `\nTx: https://testnet.bscscan.com/tx/${payload.txHash}` : "";
    await sendFollowUp(`${payload.successText ?? "USDT has been transferred to the agent wallet."}${suffix}`);
    return { text: "✅ Mission submitted. Flow completed." };
  }

  return {
    text: `${payload.successText ?? "USDT has been transferred to the agent wallet."}${
      payload.txHash ? `\nTx: https://testnet.bscscan.com/tx/${payload.txHash}` : ""
    }`,
  };
}
