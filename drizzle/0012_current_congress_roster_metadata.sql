ALTER TABLE "politicians" ADD COLUMN "district" text;
ALTER TABLE "politicians" ADD COLUMN "official_website" text;
ALTER TABLE "politicians" ADD COLUMN "image_url" text;
ALTER TABLE "politicians" ADD COLUMN "data_source" text;
ALTER TABLE "politicians" ADD COLUMN "is_active" boolean DEFAULT true;
ALTER TABLE "politicians" ADD COLUMN "bioguide_id" text;
