-- Canal de Integridade v0.23
-- Reinstala pg_net fora do schema public para atender ao Security Advisor.

DO $$
DECLARE v_job_id bigint;
BEGIN
  SELECT jobid INTO v_job_id
  FROM cron.job
  WHERE jobname='process-reporter-email-outbox'
  LIMIT 1;

  IF v_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(v_job_id);
  END IF;
END;
$$;

DROP EXTENSION IF EXISTS pg_net;
CREATE EXTENSION pg_net WITH SCHEMA extensions;

SELECT cron.schedule(
  'process-reporter-email-outbox',
  '* * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://zsxfwcbqbcvuvtcopspt.supabase.co/functions/v1/process-reporter-email-outbox',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-worker-secret',(
        SELECT decrypted_secret
        FROM vault.decrypted_secrets
        WHERE name='integridade_reporter_email_worker_secret'
        LIMIT 1
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $cron$
);