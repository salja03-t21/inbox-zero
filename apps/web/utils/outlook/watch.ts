import type { OutlookClient } from "@/utils/outlook/client";
import type { Subscription } from "@microsoft/microsoft-graph-types";
import addDays from "date-fns/addDays";
import { env } from "@/env";

export async function watchOutlook(client: OutlookClient) {
  const base =
    env.NODE_ENV === "development"
      ? env.WEBHOOK_URL || env.NEXT_PUBLIC_BASE_URL
      : env.NEXT_PUBLIC_BASE_URL;

  // must be https
  const notificationUrl = new URL("/api/outlook/webhook", base);
  if (notificationUrl.protocol === "http:") {
    notificationUrl.protocol = "https:";
  }

  const subscriptionPayload = {
    changeType: "created,updated",
    notificationUrl: notificationUrl.toString(),
    resource: `${client.getBaseUrl()}/messages`,
    expirationDateTime: addDays(new Date(), 3).toISOString(), // 3 days (max allowed)
    clientState: env.MICROSOFT_WEBHOOK_CLIENT_STATE,
  };

  const subscription: Subscription = await client
    .getClient()
    .api("/subscriptions")
    .post(subscriptionPayload);

  return {
    id: subscription.id,
    expirationDateTime: subscription.expirationDateTime,
  };
}

export async function unwatchOutlook(
  client: OutlookClient,
  subscriptionId: string,
) {
  await client.getClient().api(`/subscriptions/${subscriptionId}`).delete();
}
