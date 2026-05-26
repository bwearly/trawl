import type { EmailSendResult, SendEmailNotificationInput } from "@/lib/domain/notifications/types";

export interface NotificationSender {
  sendEmailNotification(input: SendEmailNotificationInput): Promise<EmailSendResult>;
}

class NoopNotificationSender implements NotificationSender {
  async sendEmailNotification(input: SendEmailNotificationInput): Promise<EmailSendResult> {
    if (!input.recipient) {
      return {
        status: "suppressed",
        message: "No recipient available for email delivery.",
      };
    }

    return {
      status: "noop",
      message: "No-op sender active. Live email delivery is not configured.",
    };
  }
}

class ResendNotificationSender implements NotificationSender {
  async sendEmailNotification(input: SendEmailNotificationInput): Promise<EmailSendResult> {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.ALERT_EMAIL_FROM;

    if (process.env.FORCE_PROVIDER_FAILURE === "true") {
      return { status: "suppressed", message: "Forced provider failure for testing." };
    }

    if (!input.recipient || !apiKey || !from) {
      return { status: "suppressed", message: "Missing recipient or Resend configuration." };
    }

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [input.recipient],
        subject: input.subject ?? "TRAWL notification",
        text: input.textBody ?? "You have a new watchlist notification.",
        html: input.htmlBody ?? undefined,
      }),
    });

    if (!response.ok) {
      return { status: "suppressed", message: `Resend request failed: ${response.status}` };
    }

    const data = (await response.json()) as { id?: string };
    return { status: "sent", providerMessageId: data.id, message: "Email sent via Resend." };
  }
}

export function getNotificationSender(): NotificationSender {
  const provider = process.env.NOTIFICATION_EMAIL_PROVIDER;
  const allowDev = process.env.ALLOW_DEV_EMAIL_SEND === "true";
  const isDev = process.env.NODE_ENV !== "production";

  if (isDev && !allowDev) {
    return new NoopNotificationSender();
  }

  if (provider === "resend") {
    return new ResendNotificationSender();
  }

  return new NoopNotificationSender();
}
