-- Canal de Integridade v0.22
-- Notificacoes neutras ao denunciante por e-mail opcional.
-- O endereco permanece criptografado e nunca entra em logs/auditoria.

CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

GRANT USAGE ON SCHEMA cron TO postgres;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA cron TO postgres;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM vault.decrypted_secrets
    WHERE name = 'integridade_reporter_email_worker_secret'
  ) THEN
    PERFORM vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'integridade_reporter_email_worker_secret',
      'Segredo interno do worker de notificacoes ao denunciante'
    );
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS notification_outbox_reporter_email_pending_idx
ON public.notification_outbox(available_at,id)
WHERE recipient_reporter = true
  AND channel = 'email'
  AND sent_at IS NULL
  AND failed_at IS NULL;

CREATE OR REPLACE FUNCTION public.get_reporter_email_worker_secret_internal()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=vault,public,pg_temp
AS $$
DECLARE v_secret text;
BEGIN
  IF (SELECT auth.role()) <> 'service_role' THEN
    RAISE EXCEPTION 'Somente service_role';
  END IF;

  SELECT decrypted_secret
    INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'integridade_reporter_email_worker_secret'
  LIMIT 1;

  IF v_secret IS NULL OR length(v_secret) < 32 THEN
    RAISE EXCEPTION 'worker_secret_unavailable';
  END IF;

  RETURN v_secret;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_reporter_email_outbox_internal(p_limit integer DEFAULT 5)
RETURNS TABLE(
  outbox_id bigint,
  organization_id uuid,
  report_id uuid,
  event_type text,
  attempts integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
BEGIN
  IF (SELECT auth.role()) <> 'service_role' THEN
    RAISE EXCEPTION 'Somente service_role';
  END IF;

  IF p_limit < 1 OR p_limit > 20 THEN
    RAISE EXCEPTION 'invalid_limit';
  END IF;

  RETURN QUERY
  WITH picked AS (
    SELECT o.id
    FROM public.notification_outbox o
    WHERE o.recipient_reporter = true
      AND o.channel = 'email'
      AND o.sent_at IS NULL
      AND o.failed_at IS NULL
      AND o.available_at <= now()
      AND o.attempts < 5
    ORDER BY o.available_at,o.id
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE public.notification_outbox o
     SET attempts = o.attempts + 1,
         available_at = now() + interval '5 minutes'
    FROM picked
   WHERE o.id = picked.id
  RETURNING o.id,o.organization_id,o.report_id,o.event_type,o.attempts;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_reporter_email_outbox_internal(
  p_outbox_id bigint,
  p_success boolean,
  p_error_code text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE
  v_attempts integer;
  v_error text;
  v_retry interval;
BEGIN
  IF (SELECT auth.role()) <> 'service_role' THEN
    RAISE EXCEPTION 'Somente service_role';
  END IF;

  SELECT attempts INTO v_attempts
  FROM public.notification_outbox
  WHERE id = p_outbox_id
  FOR UPDATE;

  IF v_attempts IS NULL THEN
    RAISE EXCEPTION 'outbox_not_found';
  END IF;

  IF p_success THEN
    UPDATE public.notification_outbox
       SET sent_at = COALESCE(sent_at,now()),
           failed_at = NULL,
           last_error = NULL,
           available_at = now()
     WHERE id = p_outbox_id;
    RETURN;
  END IF;

  v_error := CASE p_error_code
    WHEN 'contact_unavailable' THEN 'contact_unavailable'
    WHEN 'crypto_unavailable' THEN 'crypto_unavailable'
    WHEN 'smtp_delivery_failed' THEN 'smtp_delivery_failed'
    WHEN 'email_transport_unavailable' THEN 'email_transport_unavailable'
    ELSE 'delivery_failed'
  END;

  v_retry := CASE
    WHEN v_attempts <= 1 THEN interval '1 minute'
    WHEN v_attempts = 2 THEN interval '5 minutes'
    WHEN v_attempts = 3 THEN interval '15 minutes'
    WHEN v_attempts = 4 THEN interval '30 minutes'
    ELSE interval '1 hour'
  END;

  UPDATE public.notification_outbox
     SET last_error = v_error,
         failed_at = CASE WHEN v_attempts >= 5 THEN now() ELSE NULL END,
         available_at = CASE WHEN v_attempts >= 5 THEN available_at ELSE now() + v_retry END
   WHERE id = p_outbox_id;
END;
$$;

CREATE OR REPLACE FUNCTION operations_private.log_report_state_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE
  v_summary text;
  v_email_enabled boolean := false;
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    v_summary := CASE NEW.status
      WHEN 'new' THEN 'O relato está aguardando triagem.'
      WHEN 'triage' THEN 'O relato está em triagem.'
      WHEN 'investigating' THEN 'A análise do relato está em andamento.'
      WHEN 'waiting_reporter' THEN 'A equipe aguarda uma informação complementar.'
      WHEN 'waiting_internal' THEN 'O relato segue em análise interna.'
      WHEN 'resolved' THEN 'A apuração foi concluída.'
      WHEN 'closed' THEN 'O relato foi encerrado.'
      WHEN 'dismissed' THEN 'A análise do relato foi concluída.'
      ELSE NULL
    END;

    INSERT INTO public.report_events(report_id,event_type,public_summary,internal_metadata,created_by)
    VALUES(
      NEW.id,
      'status_changed',
      v_summary,
      jsonb_build_object('before',OLD.status,'after',NEW.status),
      (SELECT auth.uid())
    );

    SELECT COALESCE(c.email_enabled,false)
      INTO v_email_enabled
    FROM public.report_contacts c
    WHERE c.report_id = NEW.id;

    IF v_email_enabled THEN
      INSERT INTO public.notification_outbox(
        organization_id,report_id,event_type,recipient_reporter,channel,payload
      ) VALUES(
        NEW.organization_id,
        NEW.id,
        'reporter_status_changed',
        true,
        'email',
        jsonb_build_object('generic',true)
      );
    END IF;
  END IF;

  IF OLD.priority IS DISTINCT FROM NEW.priority THEN
    INSERT INTO public.report_events(report_id,event_type,public_summary,internal_metadata,created_by)
    VALUES(
      NEW.id,
      'priority_changed',
      NULL,
      jsonb_build_object('before',OLD.priority,'after',NEW.priority),
      (SELECT auth.uid())
    );
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.get_reporter_email_worker_secret_internal() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.claim_reporter_email_outbox_internal(integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.complete_reporter_email_outbox_internal(bigint,boolean,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_reporter_email_worker_secret_internal() TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_reporter_email_outbox_internal(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_reporter_email_outbox_internal(bigint,boolean,text) TO service_role;
REVOKE ALL ON FUNCTION operations_private.log_report_state_event() FROM PUBLIC,anon,authenticated;

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