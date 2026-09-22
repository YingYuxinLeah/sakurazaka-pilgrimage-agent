CREATE TABLE `demo_client_usage` (
	`day` text NOT NULL,
	`client_hash` text NOT NULL,
	`request_count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`day`, `client_hash`)
);
--> statement-breakpoint
CREATE TABLE `demo_daily_usage` (
	`day` text PRIMARY KEY NOT NULL,
	`request_count` integer DEFAULT 0 NOT NULL
);
