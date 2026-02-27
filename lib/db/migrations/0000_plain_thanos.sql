CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid NOT NULL,
	"agent_secret" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"hardware_model" varchar(100),
	"serial_number" varchar(100),
	"status" varchar(20) DEFAULT 'offline' NOT NULL,
	"last_heartbeat" timestamp with time zone,
	"ip_address" varchar(45),
	"software_version" varchar(50),
	"config" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_coaching_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"gym_id" uuid NOT NULL,
	"message" text NOT NULL,
	"model" varchar(100) NOT NULL,
	"athlete_summaries" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "athlete_bands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"athlete_id" uuid NOT NULL,
	"gym_id" uuid NOT NULL,
	"sensor_id" integer NOT NULL,
	"band_label" varchar(50),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_athlete_bands_gym_sensor" UNIQUE("gym_id","sensor_id")
);
--> statement-breakpoint
CREATE TABLE "athletes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"gym_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"email" varchar(255),
	"phone" varchar(50),
	"age" integer,
	"gender" varchar(10),
	"weight_kg" numeric(5, 2),
	"max_hr" integer DEFAULT 190 NOT NULL,
	"whatsapp_opt_in" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gym_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"gym_id" uuid NOT NULL,
	"role" varchar(20) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_gym_memberships_user_gym" UNIQUE("user_id","gym_id")
);
--> statement-breakpoint
CREATE TABLE "gyms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"address" text,
	"phone" varchar(50),
	"timezone" varchar(50) DEFAULT 'America/Sao_Paulo' NOT NULL,
	"language" varchar(10) DEFAULT 'pt-BR' NOT NULL,
	"clerk_org_id" varchar(255) NOT NULL,
	"tv_access_token" uuid DEFAULT gen_random_uuid() NOT NULL,
	"subscription_status" varchar(20) DEFAULT 'active' NOT NULL,
	"subscription_plan" varchar(100),
	"max_athletes" integer DEFAULT 20 NOT NULL,
	"logo_url" text,
	"primary_color" varchar(7) DEFAULT '#000000',
	"secondary_color" varchar(7) DEFAULT '#FFFFFF',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gyms_slug_unique" UNIQUE("slug"),
	CONSTRAINT "gyms_clerk_org_id_unique" UNIQUE("clerk_org_id")
);
--> statement-breakpoint
CREATE TABLE "hr_bands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid NOT NULL,
	"sensor_id" integer NOT NULL,
	"band_label" varchar(50),
	"brand" varchar(100),
	"model" varchar(100),
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"purchased_at" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_readings" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"gym_id" uuid NOT NULL,
	"athlete_id" uuid NOT NULL,
	"sensor_id" integer NOT NULL,
	"heart_rate_bpm" integer NOT NULL,
	"hr_zone" integer NOT NULL,
	"hr_zone_name" varchar(20) NOT NULL,
	"hr_zone_color" varchar(7) NOT NULL,
	"hr_max_percent" numeric(5, 2) NOT NULL,
	"beat_time" timestamp with time zone NOT NULL,
	"beat_count" integer DEFAULT 0 NOT NULL,
	"device_active" boolean DEFAULT true NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_athletes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"athlete_id" uuid NOT NULL,
	"sensor_id" integer,
	"avg_hr" integer,
	"max_hr" integer,
	"min_hr" integer,
	"calories" integer,
	"time_zone_1_s" integer DEFAULT 0 NOT NULL,
	"time_zone_2_s" integer DEFAULT 0 NOT NULL,
	"time_zone_3_s" integer DEFAULT 0 NOT NULL,
	"time_zone_4_s" integer DEFAULT 0 NOT NULL,
	"time_zone_5_s" integer DEFAULT 0 NOT NULL,
	"joined_at" timestamp with time zone,
	"left_at" timestamp with time zone,
	"report_token" varchar(255),
	"whatsapp_sent_at" timestamp with time zone,
	"whatsapp_status" varchar(20),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_session_athletes_session_athlete" UNIQUE("session_id","athlete_id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid NOT NULL,
	"trainer_id" uuid,
	"class_type" varchar(100),
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"duration_seconds" integer,
	"athlete_count" integer DEFAULT 0 NOT NULL,
	"ai_summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_user_id" varchar(255) NOT NULL,
	"email" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"phone" varchar(50),
	"is_superadmin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_clerk_user_id_unique" UNIQUE("clerk_user_id")
);
--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_coaching_messages" ADD CONSTRAINT "ai_coaching_messages_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_coaching_messages" ADD CONSTRAINT "ai_coaching_messages_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "athlete_bands" ADD CONSTRAINT "athlete_bands_athlete_id_athletes_id_fk" FOREIGN KEY ("athlete_id") REFERENCES "public"."athletes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "athlete_bands" ADD CONSTRAINT "athlete_bands_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "athletes" ADD CONSTRAINT "athletes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "athletes" ADD CONSTRAINT "athletes_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_memberships" ADD CONSTRAINT "gym_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_memberships" ADD CONSTRAINT "gym_memberships_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_bands" ADD CONSTRAINT "hr_bands_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_readings" ADD CONSTRAINT "hr_readings_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_readings" ADD CONSTRAINT "hr_readings_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_readings" ADD CONSTRAINT "hr_readings_athlete_id_athletes_id_fk" FOREIGN KEY ("athlete_id") REFERENCES "public"."athletes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_athletes" ADD CONSTRAINT "session_athletes_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_athletes" ADD CONSTRAINT "session_athletes_athlete_id_athletes_id_fk" FOREIGN KEY ("athlete_id") REFERENCES "public"."athletes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_trainer_id_users_id_fk" FOREIGN KEY ("trainer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_agents_gym" ON "agents" USING btree ("gym_id");--> statement-breakpoint
CREATE INDEX "idx_ai_coaching_messages_session" ON "ai_coaching_messages" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_athlete_bands_gym" ON "athlete_bands" USING btree ("gym_id","sensor_id") WHERE is_active = true;--> statement-breakpoint
CREATE INDEX "idx_athletes_gym" ON "athletes" USING btree ("gym_id") WHERE is_active = true;--> statement-breakpoint
CREATE INDEX "idx_gym_memberships_user" ON "gym_memberships" USING btree ("user_id") WHERE is_active = true;--> statement-breakpoint
CREATE INDEX "idx_gym_memberships_gym" ON "gym_memberships" USING btree ("gym_id") WHERE is_active = true;--> statement-breakpoint
CREATE INDEX "idx_hr_readings_session_time" ON "hr_readings" USING btree ("session_id","recorded_at");--> statement-breakpoint
CREATE INDEX "idx_hr_readings_gym_time" ON "hr_readings" USING btree ("gym_id","recorded_at");--> statement-breakpoint
CREATE INDEX "idx_hr_readings_athlete" ON "hr_readings" USING btree ("athlete_id","recorded_at");--> statement-breakpoint
CREATE INDEX "idx_session_athletes_session" ON "session_athletes" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "idx_session_athletes_athlete" ON "session_athletes" USING btree ("athlete_id");--> statement-breakpoint
CREATE INDEX "idx_sessions_gym" ON "sessions" USING btree ("gym_id","started_at");--> statement-breakpoint
CREATE INDEX "idx_sessions_active" ON "sessions" USING btree ("gym_id","status") WHERE status = 'active';