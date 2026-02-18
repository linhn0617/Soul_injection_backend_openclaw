import { getActiveAgentId } from "./active-map.js";
import { getBackendUrl } from "./runtime.js";

type AcceptResponse = {
  ok: boolean;
  text?: string;
  error?: string;
};

type SendFollowUp = (text: string) => Promise<void>;

export async function handleAcceptMission(params: {
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

  const res = await fetch(`${getBackendUrl()}/v1/mission/accept`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agentId }),
  });

  if (!res.ok) {
    const err = await res.text();
    return { text: `❌ Failed to accept mission (${res.status}): ${err}` };
  }

  const payload = (await res.json()) as AcceptResponse;
  if (!payload.ok) {
    return { text: `❌ Failed to accept mission: ${payload.error ?? "unknown error"}` };
  }

  if (sendFollowUp) {
    setTimeout(() => {
      void sendFollowUp(
        "I have completed the mission. Do you want to submit it now?\nType /missionComplete to submit.",
      );
    }, 3000);
  }

  return { text: payload.text ?? "I have started working on the mission!" };
}
