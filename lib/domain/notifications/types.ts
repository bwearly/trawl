export type NotificationChannel = "email";

export type NotificationJobStatus =
  | "queued"
  | "sending"
  | "sent"
  | "failed"
  | "suppressed";

export type NotificationEventType =
  | "queued"
  | "sending"
  | "sent"
  | "failed"
  | "suppressed"
  | "skipped_no_recipient"
  | "noop";

export type EmailSendResult = {
  status: "sent" | "noop" | "suppressed";
  providerMessageId?: string;
  message?: string;
};

export type SendEmailNotificationInput = {
  userId: string;
  recipient: string | null;
  alertId: number | null;
  idempotencyKey: string;
  subject?: string | null;
  textBody?: string | null;
  htmlBody?: string | null;
};
