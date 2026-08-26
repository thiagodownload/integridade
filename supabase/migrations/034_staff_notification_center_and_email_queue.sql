-- Canal de Integridade v0.34
-- Central de notificacoes internas e fila transacional de e-mail para usuarios internos.
-- Avisos sao neutros e individualizados. Nenhum conteudo sensivel entra no payload.

ALTER TABLE public.notification_outbox
  ADD COLUMN IF NOT EXISTS read_at timestamptz;

CREATE INDEX IF NOT EXISTS notification_outbox_in_app_user_idx
ON public.notification_outbox(recipient_user_id,read_at,id DESC)
WHERE channel = 'in_app'
  AND recipient_user_id IS NOT NULL
  AND recipient_reporter = false;

CREATE INDEX IF NOT EXISTS notification_outbox_staff_email_pending_idx
ON public.notification_outbox(available_at,id)
WHERE recipient_reporter = false
  AND recipient_user_id IS NOT NULL
  AND channel = 'email'
  AND event_type IN (
    'report.assignment.granted',
    'report.created',
    'report.restricted.created',
    'report.message.created'
  )
  AND sent_at IS NULL
  AND failed_at IS NULL;

UPDATE public.notification_rules
SET enabled = false
WHERE event_type = 'report.restricted.created'
  AND channel = 'email'
  AND destination_role <> 'privacy_officer'::public.staff_role;

INSERT INTO public.notification_rules(organization_id,event_type,channel,destination_role,enabled)
SELECT o.id,'report.created','email','compliance_manager'::public.staff_role,true
FROM public.organizations o
WHERE o.slug = 'integridade'
  AND NOT EXISTS (
    SELECT 1 FROM public.notification_rules n
    WHERE n.organization_id=o.id
      AND n.event_type='report.created'
      AND n.channel='email'
      AND n.destination_role='compliance_manager'::public.staff_role
  );

INSERT INTO public.notification_rules(organization_id,event_type,channel,destination_role,enabled)
SELECT o.id,'report.restricted.created','email','privacy_officer'::public.staff_role,true
FROM public.organizations o
WHERE o.slug = 'integridade'
  AND NOT EXISTS (
    SELECT 1 FROM public.notification_rules n
    WHERE n.organization_id=o.id
      AND n.event_type='report.restricted.created'
      AND n.channel='email'
      AND n.destination_role='privacy_officer'::public.staff_role
  );

INSERT INTO public.notification_rules(organization_id,event_type,channel,destination_role,enabled)
SELECT o.id,'report.message.created','email','privacy_officer'::public.staff_role,true
FROM public.organizations o
WHERE o.slug = 'integridade'
  AND NOT EXISTS (
    SELECT 1 FROM public.notification_rules n
    WHERE n.organization_id=o.id
      AND n.event_type='report.message.created'
      AND n.channel='email'
      AND n.destination_role='privacy_officer'::public.staff_role
  );

DELETE FROM public.notification_outbox
WHERE channel = 'in_app'
  AND recipient_user_id IS NULL
  AND recipient_reporter = false;

CREATE OR REPLACE FUNCTION operations_private.reject_unaddressed_internal_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
BEGIN
  IF NEW.channel = 'in_app'
     AND NEW.recipient_reporter = false
     AND NEW.recipient_user_id IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notification_outbox_reject_unaddressed_internal ON public.notification_outbox;
CREATE TRIGGER notification_outbox_reject_unaddressed_internal
BEFORE INSERT ON public.notification_outbox
FOR EACH ROW
EXECUTE FUNCTION operations_private.reject_unaddressed_internal_notification();

CREATE OR REPLACE FUNCTION operations_private.queue_new_report_staff_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE
  v_role public.staff_role;
  v_event_type text;
  v_email_enabled boolean := false;
BEGIN
  v_role := CASE WHEN NEW.restricted THEN 'privacy_officer'::public.staff_role ELSE 'compliance_manager'::public.staff_role END;
  v_event_type := CASE WHEN NEW.restricted THEN 'report.restricted.created' ELSE 'report.created' END;

  INSERT INTO public.notification_outbox(
    organization_id,report_id,event_type,recipient_user_id,recipient_reporter,channel,payload
  )
  SELECT DISTINCT
    NEW.organization_id,NEW.id,v_event_type,sr.user_id,false,'in_app',jsonb_build_object('generic',true)
  FROM public.staff_roles sr
  JOIN public.staff_profiles sp ON sp.user_id=sr.user_id
  WHERE sr.role=v_role
    AND sp.organization_id=NEW.organization_id
    AND sp.active=true
    AND sp.email_confirmed_at IS NOT NULL;

  SELECT EXISTS(
    SELECT 1
    FROM public.notification_rules nr
    WHERE nr.organization_id=NEW.organization_id
      AND nr.event_type=v_event_type
      AND nr.channel='email'
      AND nr.destination_role=v_role
      AND nr.enabled=true
  ) INTO v_email_enabled;

  IF v_email_enabled THEN
    INSERT INTO public.notification_outbox(
      organization_id,report_id,event_type,recipient_user_id,recipient_reporter,channel,payload
    )
    SELECT DISTINCT
      NEW.organization_id,NEW.id,v_event_type,sr.user_id,false,'email',jsonb_build_object('generic',true)
    FROM public.staff_roles sr
    JOIN public.staff_profiles sp ON sp.user_id=sr.user_id
    WHERE sr.role=v_role
      AND sp.organization_id=NEW.organization_id
      AND sp.active=true
      AND sp.email_confirmed_at IS NOT NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS report_new_staff_notifications ON public.reports;
CREATE TRIGGER report_new_staff_notifications
AFTER INSERT ON public.reports
FOR EACH ROW
EXECUTE FUNCTION operations_private.queue_new_report_staff_notifications();

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

  SELECT organization_id INTO v_org_id
  FROM public.reports
  WHERE id=NEW.report_id;

  IF v_org_id IS NULL THEN RETURN NEW; END IF;

  INSERT INTO public.notification_outbox(
    organization_id,report_id,event_type,recipient_user_id,recipient_reporter,channel,payload
  ) VALUES
    (v_org_id,NEW.report_id,'report.assignment.granted',NEW.user_id,false,'email',jsonb_build_object('assignment_type',NEW.assignment_type::text)),
    (v_org_id,NEW.report_id,'report.assignment.granted',NEW.user_id,false,'in_app',jsonb_build_object('assignment_type',NEW.assignment_type::text));

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION operations_private.queue_reporter_message_staff_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE
  v_org_id uuid;
  v_restricted boolean;
  v_role public.staff_role;
  v_email_enabled boolean := false;
BEGIN
  IF NEW.author_type::text <> 'reporter' THEN RETURN NEW; END IF;

  SELECT organization_id,restricted
    INTO v_org_id,v_restricted
  FROM public.reports
  WHERE id=NEW.report_id;

  IF v_org_id IS NULL THEN RETURN NEW; END IF;
  v_role := CASE WHEN v_restricted THEN 'privacy_officer'::public.staff_role ELSE 'compliance_manager'::public.staff_role END;

  WITH recipients AS (
    SELECT a.user_id
    FROM public.report_assignments a
    JOIN public.staff_profiles sp ON sp.user_id=a.user_id
    WHERE a.report_id=NEW.report_id
      AND a.revoked_at IS NULL
      AND sp.organization_id=v_org_id
      AND sp.active=true
    UNION
    SELECT sr.user_id
    FROM public.staff_roles sr
    JOIN public.staff_profiles sp ON sp.user_id=sr.user_id
    WHERE sr.role=v_role
      AND sp.organization_id=v_org_id
      AND sp.active=true
  )
  INSERT INTO public.notification_outbox(
    organization_id,report_id,event_type,recipient_user_id,recipient_reporter,channel,payload
  )
  SELECT DISTINCT v_org_id,NEW.report_id,'report.message.created',r.user_id,false,'in_app',jsonb_build_object('generic',true)
  FROM recipients r;

  SELECT EXISTS(
    SELECT 1 FROM public.notification_rules nr
    WHERE nr.organization_id=v_org_id
      AND nr.event_type='report.message.created'
      AND nr.channel='email'
      AND nr.destination_role=v_role
      AND nr.enabled=true
  ) INTO v_email_enabled;

  IF v_email_enabled THEN
    INSERT INTO public.notification_outbox(
      organization_id,report_id,event_type,recipient_user_id,recipient_reporter,channel,payload
    )
    SELECT DISTINCT v_org_id,NEW.report_id,'report.message.created',sr.user_id,false,'email',jsonb_build_object('generic',true)
    FROM public.staff_roles sr
    JOIN public.staff_profiles sp ON sp.user_id=sr.user_id
    WHERE sr.role=v_role
      AND sp.organization_id=v_org_id
      AND sp.active=true
      AND sp.email_confirmed_at IS NOT NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reporter_message_staff_notifications ON public.report_messages;
CREATE TRIGGER reporter_message_staff_notifications
AFTER INSERT ON public.report_messages
FOR EACH ROW
EXECUTE FUNCTION operations_private.queue_reporter_message_staff_notifications();

CREATE OR REPLACE FUNCTION public.claim_staff_email_outbox_internal(p_limit integer DEFAULT 10)
RETURNS TABLE(
  outbox_id bigint,
  organization_id uuid,
  report_id uuid,
  recipient_user_id uuid,
  event_type text,
  payload jsonb,
  attempts integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
BEGIN
  IF (SELECT auth.role()) <> 'service_role' THEN RAISE EXCEPTION 'Somente service_role'; END IF;
  IF p_limit < 1 OR p_limit > 50 THEN RAISE EXCEPTION 'invalid_limit'; END IF;

  RETURN QUERY
  WITH picked AS (
    SELECT o.id
    FROM public.notification_outbox o
    WHERE o.recipient_reporter=false
      AND o.recipient_user_id IS NOT NULL
      AND o.channel='email'
      AND o.event_type IN ('report.assignment.granted','report.created','report.restricted.created','report.message.created')
      AND o.sent_at IS NULL
      AND o.failed_at IS NULL
      AND o.available_at <= now()
      AND o.attempts < 5
    ORDER BY o.available_at,o.id
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE public.notification_outbox o
     SET attempts=o.attempts+1,
         available_at=now()+interval '5 minutes'
    FROM picked
   WHERE o.id=picked.id
  RETURNING o.id,o.organization_id,o.report_id,o.recipient_user_id,o.event_type,o.payload,o.attempts;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_staff_email_outbox_internal(
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
  IF (SELECT auth.role()) <> 'service_role' THEN RAISE EXCEPTION 'Somente service_role'; END IF;

  SELECT attempts INTO v_attempts
  FROM public.notification_outbox
  WHERE id=p_outbox_id
  FOR UPDATE;
  IF v_attempts IS NULL THEN RAISE EXCEPTION 'outbox_not_found'; END IF;

  IF p_success THEN
    UPDATE public.notification_outbox
       SET sent_at=COALESCE(sent_at,now()),failed_at=NULL,last_error=NULL,available_at=now()
     WHERE id=p_outbox_id;
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
     SET last_error=v_error,
         failed_at=CASE WHEN v_attempts >= 5 THEN now() ELSE NULL END,
         available_at=CASE WHEN v_attempts >= 5 THEN available_at ELSE now()+v_retry END
   WHERE id=p_outbox_id;
END;
$$;

CREATE OR REPLACE FUNCTION operations_private.staff_list_notifications(p_limit integer DEFAULT 50)
RETURNS TABLE(
  id bigint,
  event_type text,
  report_id uuid,
  payload jsonb,
  created_at timestamptz,
  read_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT app_private.is_aal2() THEN RAISE EXCEPTION 'mfa_required'; END IF;
  IF p_limit < 1 OR p_limit > 100 THEN RAISE EXCEPTION 'invalid_limit'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.staff_profiles sp WHERE sp.user_id=(SELECT auth.uid()) AND sp.active=true) THEN
    RAISE EXCEPTION 'inactive_profile';
  END IF;

  RETURN QUERY
  SELECT o.id,o.event_type,o.report_id,o.payload,o.available_at,o.read_at
  FROM public.notification_outbox o
  WHERE o.channel='in_app'
    AND o.recipient_reporter=false
    AND o.recipient_user_id=(SELECT auth.uid())
    AND o.available_at <= now()
  ORDER BY o.id DESC
  LIMIT p_limit;
END;
$$;

CREATE OR REPLACE FUNCTION public.staff_list_notifications(p_limit integer DEFAULT 50)
RETURNS TABLE(id bigint,event_type text,report_id uuid,payload jsonb,created_at timestamptz,read_at timestamptz)
LANGUAGE sql
SECURITY INVOKER
SET search_path=public,pg_temp
AS $$ SELECT * FROM operations_private.staff_list_notifications(p_limit) $$;

CREATE OR REPLACE FUNCTION operations_private.staff_unread_notification_count()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT app_private.is_aal2() THEN RAISE EXCEPTION 'mfa_required'; END IF;
  RETURN (
    SELECT count(*)
    FROM public.notification_outbox o
    WHERE o.channel='in_app'
      AND o.recipient_reporter=false
      AND o.recipient_user_id=(SELECT auth.uid())
      AND o.read_at IS NULL
      AND o.available_at <= now()
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.staff_unread_notification_count()
RETURNS bigint
LANGUAGE sql
SECURITY INVOKER
SET search_path=public,pg_temp
AS $$ SELECT operations_private.staff_unread_notification_count() $$;

CREATE OR REPLACE FUNCTION operations_private.staff_mark_notification_read(p_notification_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT app_private.is_aal2() THEN RAISE EXCEPTION 'mfa_required'; END IF;
  UPDATE public.notification_outbox
     SET read_at=COALESCE(read_at,now())
   WHERE id=p_notification_id
     AND channel='in_app'
     AND recipient_user_id=(SELECT auth.uid());
END;
$$;

CREATE OR REPLACE FUNCTION public.staff_mark_notification_read(p_notification_id bigint)
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path=public,pg_temp
AS $$ SELECT operations_private.staff_mark_notification_read(p_notification_id) $$;

CREATE OR REPLACE FUNCTION operations_private.staff_mark_all_notifications_read()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT app_private.is_aal2() THEN RAISE EXCEPTION 'mfa_required'; END IF;
  UPDATE public.notification_outbox
     SET read_at=COALESCE(read_at,now())
   WHERE channel='in_app'
     AND recipient_user_id=(SELECT auth.uid())
     AND read_at IS NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.staff_mark_all_notifications_read()
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path=public,pg_temp
AS $$ SELECT operations_private.staff_mark_all_notifications_read() $$;

REVOKE ALL ON FUNCTION operations_private.reject_unaddressed_internal_notification() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION operations_private.queue_new_report_staff_notifications() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION operations_private.queue_assignment_email_notification() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION operations_private.queue_reporter_message_staff_notifications() FROM PUBLIC,anon,authenticated;

REVOKE ALL ON FUNCTION public.claim_staff_email_outbox_internal(integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.complete_staff_email_outbox_internal(bigint,boolean,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_staff_email_outbox_internal(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_staff_email_outbox_internal(bigint,boolean,text) TO service_role;

REVOKE ALL ON FUNCTION operations_private.staff_list_notifications(integer) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION operations_private.staff_unread_notification_count() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION operations_private.staff_mark_notification_read(bigint) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION operations_private.staff_mark_all_notifications_read() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION operations_private.staff_list_notifications(integer) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION operations_private.staff_unread_notification_count() TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION operations_private.staff_mark_notification_read(bigint) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION operations_private.staff_mark_all_notifications_read() TO authenticated,service_role;

REVOKE ALL ON FUNCTION public.staff_list_notifications(integer) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.staff_unread_notification_count() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.staff_mark_notification_read(bigint) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.staff_mark_all_notifications_read() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.staff_list_notifications(integer) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.staff_unread_notification_count() TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.staff_mark_notification_read(bigint) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.staff_mark_all_notifications_read() TO authenticated,service_role;

DO $$
DECLARE v_job_id bigint;
BEGIN
  SELECT jobid INTO v_job_id FROM cron.job WHERE jobname='process-staff-assignment-outbox' LIMIT 1;
  IF v_job_id IS NOT NULL THEN PERFORM cron.unschedule(v_job_id); END IF;
  SELECT jobid INTO v_job_id FROM cron.job WHERE jobname='process-staff-email-outbox' LIMIT 1;
  IF v_job_id IS NOT NULL THEN PERFORM cron.unschedule(v_job_id); END IF;
END;
$$;

SELECT cron.schedule(
  'process-staff-email-outbox',
  '* * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://zsxfwcbqbcvuvtcopspt.supabase.co/functions/v1/process-staff-email-outbox',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-worker-secret',(
        SELECT decrypted_secret FROM vault.decrypted_secrets
        WHERE name='integridade_staff_assignment_worker_secret' LIMIT 1
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $cron$
);