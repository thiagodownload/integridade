-- Canal de Integridade v0.28
-- Notificacao por e-mail para usuarios internos adicionados a um caso.
-- Principal, colaborador e observador recebem aviso neutro, sem dados sensiveis.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM vault.decrypted_secrets
    WHERE name = 'integridade_staff_assignment_worker_secret'
  ) THEN
    PERFORM vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'integridade_staff_assignment_worker_secret',
      'Segredo interno do worker de notificacoes de atribuicao'
    );
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS notification_outbox_staff_assignment_pending_idx
ON public.notification_outbox(available_at,id)
WHERE recipient_reporter = false
  AND recipient_user_id IS NOT NULL
  AND channel = 'email'
  AND event_type = 'report.assignment.granted'
  AND sent_at IS NULL
  AND failed_at IS NULL;

CREATE OR REPLACE FUNCTION public.get_staff_assignment_worker_secret_internal()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=vault,public,pg_temp
AS $$
DECLARE
  v_secret text;
BEGIN
  IF (SELECT auth.role()) <> 'service_role' THEN
    RAISE EXCEPTION 'Somente service_role';
  END IF;

  SELECT decrypted_secret
    INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'integridade_staff_assignment_worker_secret'
  LIMIT 1;

  IF v_secret IS NULL OR length(v_secret) < 32 THEN
    RAISE EXCEPTION 'worker_secret_unavailable';
  END IF;

  RETURN v_secret;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_staff_assignment_outbox_internal(p_limit integer DEFAULT 10)
RETURNS TABLE(
  outbox_id bigint,
  organization_id uuid,
  report_id uuid,
  recipient_user_id uuid,
  assignment_type text,
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

  IF p_limit < 1 OR p_limit > 50 THEN
    RAISE EXCEPTION 'invalid_limit';
  END IF;

  RETURN QUERY
  WITH picked AS (
    SELECT o.id
    FROM public.notification_outbox o
    WHERE o.recipient_reporter = false
      AND o.recipient_user_id IS NOT NULL
      AND o.channel = 'email'
      AND o.event_type = 'report.assignment.granted'
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
  RETURNING
    o.id,
    o.organization_id,
    o.report_id,
    o.recipient_user_id,
    COALESCE(o.payload->>'assignment_type','collaborator'),
    o.attempts;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_staff_assignment_outbox_internal(
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

  SELECT attempts
    INTO v_attempts
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
    WHEN 'recipient_unavailable' THEN 'recipient_unavailable'
    WHEN 'email_transport_unavailable' THEN 'email_transport_unavailable'
    WHEN 'smtp_delivery_failed' THEN 'smtp_delivery_failed'
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

CREATE OR REPLACE FUNCTION operations_private.queue_assignment_email_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE
  v_org_id uuid;
  v_should_notify boolean := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_should_notify := NEW.revoked_at IS NULL;
  ELSIF TG_OP = 'UPDATE' THEN
    v_should_notify := (
      (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NULL)
      OR (
        OLD.revoked_at IS NULL
        AND NEW.revoked_at IS NULL
        AND OLD.assignment_type IS DISTINCT FROM NEW.assignment_type
      )
    );
  END IF;

  IF NOT v_should_notify THEN
    RETURN NEW;
  END IF;

  SELECT organization_id
    INTO v_org_id
  FROM public.reports
  WHERE id = NEW.report_id;

  IF v_org_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notification_outbox(
    organization_id,
    report_id,
    event_type,
    recipient_user_id,
    recipient_reporter,
    channel,
    payload
  ) VALUES (
    v_org_id,
    NEW.report_id,
    'report.assignment.granted',
    NEW.user_id,
    false,
    'email',
    jsonb_build_object('assignment_type',NEW.assignment_type::text)
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS report_assignment_email_notification ON public.report_assignments;
CREATE TRIGGER report_assignment_email_notification
AFTER INSERT OR UPDATE OF assignment_type,revoked_at ON public.report_assignments
FOR EACH ROW
EXECUTE FUNCTION operations_private.queue_assignment_email_notification();

REVOKE ALL ON FUNCTION public.get_staff_assignment_worker_secret_internal() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.claim_staff_assignment_outbox_internal(integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.complete_staff_assignment_outbox_internal(bigint,boolean,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_staff_assignment_worker_secret_internal() TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_staff_assignment_outbox_internal(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_staff_assignment_outbox_internal(bigint,boolean,text) TO service_role;
REVOKE ALL ON FUNCTION operations_private.queue_assignment_email_notification() FROM PUBLIC,anon,authenticated;

DO $$
DECLARE
  v_job_id bigint;
BEGIN
  SELECT jobid
    INTO v_job_id
  FROM cron.job
  WHERE jobname = 'process-staff-assignment-outbox'
  LIMIT 1;

  IF v_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(v_job_id);
  END IF;
END;
$$;

SELECT cron.schedule(
  'process-staff-assignment-outbox',
  '* * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://zsxfwcbqbcvuvtcopspt.supabase.co/functions/v1/process-staff-assignment-outbox',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-worker-secret',(
        SELECT decrypted_secret
        FROM vault.decrypted_secrets
        WHERE name='integridade_staff_assignment_worker_secret'
        LIMIT 1
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $cron$
);