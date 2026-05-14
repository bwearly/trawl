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

export function getNotificationSender(): NotificationSender {
  return new NoopNotificationSender();
}
