CREATE TABLE "translation_job_chunks" (
	"job_id" text NOT NULL,
	"chunk_index" integer NOT NULL,
	"source_text" text NOT NULL,
	"text_length" integer NOT NULL,
	"translation" text,
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"latency_ms" integer,
	"error" text,
	"completed_at" timestamp,
	CONSTRAINT "translation_job_chunks_job_id_chunk_index_pk" PRIMARY KEY("job_id","chunk_index")
);
--> statement-breakpoint
ALTER TABLE "translation_job_chunks" ADD CONSTRAINT "translation_job_chunks_job_id_translation_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."translation_jobs"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
INSERT INTO "translation_job_chunks" (
	"job_id", "chunk_index", "source_text", "text_length", "translation",
	"prompt_tokens", "completion_tokens", "latency_ms", "error", "completed_at"
)
SELECT
	job."id",
	COALESCE((chunk.value->>'index')::integer, chunk.ordinality::integer - 1),
	COALESCE(chunk.value->>'text', ''),
	COALESCE((chunk.value->>'textLength')::integer, length(COALESCE(chunk.value->>'text', ''))),
	chunk.value->>'translation',
	(chunk.value->>'promptTokens')::integer,
	(chunk.value->>'completionTokens')::integer,
	(chunk.value->>'latencyMs')::integer,
	chunk.value->>'error',
	CASE
		WHEN COALESCE((chunk.value->>'hasTranslation')::boolean, chunk.value ? 'translation')
		THEN job."updated_at"
		ELSE NULL
	END
FROM "translation_jobs" job
CROSS JOIN LATERAL jsonb_array_elements(
	COALESCE(NULLIF(job."chunks_json", '')::jsonb, '[]'::jsonb)
) WITH ORDINALITY AS chunk(value, ordinality)
ON CONFLICT DO NOTHING;