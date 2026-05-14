CREATE TABLE "notification_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" integer NOT NULL,
	"alert_id" integer,
	"user_id" text NOT NULL,
	"channel" text DEFAULT 'email' NOT NULL,
	"event_type" text NOT NULL,
	"message" text,
	"metadata" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"alert_id" integer,
	"user_id" text NOT NULL,
	"channel" text DEFAULT 'email' NOT NULL,
	"recipient" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"idempotency_key" text NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"scheduled_for" timestamp DEFAULT now() NOT NULL,
	"last_attempt_at" timestamp,
	"sent_at" timestamp,
	"provider_message_id" text,
	"error_code" text,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_events" ADD CONSTRAINT "notification_events_job_id_notification_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."notification_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_events" ADD CONSTRAINT "notification_events_alert_id_alerts_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."alerts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_jobs" ADD CONSTRAINT "notification_jobs_alert_id_alerts_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."alerts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_events_job_id_idx" ON "notification_events" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "notification_events_user_id_idx" ON "notification_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notification_events_event_type_idx" ON "notification_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "notification_jobs_user_id_idx" ON "notification_jobs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notification_jobs_status_idx" ON "notification_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "notification_jobs_scheduled_for_idx" ON "notification_jobs" USING btree ("scheduled_for");--> statement-breakpoint
CREATE INDEX "notification_jobs_alert_id_idx" ON "notification_jobs" USING btree ("alert_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_jobs_idempotency_key_idx" ON "notification_jobs" USING btree ("idempotency_key");