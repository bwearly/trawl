CREATE TABLE "politicians" (
	"id" serial PRIMARY KEY NOT NULL,
	"full_name" text NOT NULL,
	"chamber" text NOT NULL,
	"party" text,
	"state" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
