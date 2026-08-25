-- Canal de Integridade v0.32
-- Ativa no formulário público os anexos de imagem quando habilitados na organização.
-- O upload continua restrito a JPEG/PNG/WebP sanitizados pelo gateway.

CREATE OR REPLACE FUNCTION public.get_public_form_config_internal()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE v_result jsonb;
BEGIN
  IF (SELECT auth.role()) <> 'service_role' THEN
    RAISE EXCEPTION 'Somente service_role';
  END IF;

  SELECT jsonb_build_object(
    'organizationSlug',o.slug,
    'publicName',s.public_name,
    'welcomeText',s.welcome_text,
    'allowAnonymous',s.allow_anonymous,
    'allowOptionalEmail',s.allow_optional_email,
    'allowAttachments',s.allow_attachments,
    'privacyNoticeVersion',s.privacy_notice_version,
    'categories',COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object('id',c.id,'name',c.name,'description',c.description)
        ORDER BY c.name
      )
      FROM public.report_categories c
      WHERE c.organization_id=o.id
        AND c.active
    ),'[]'::jsonb)
  ) INTO v_result
  FROM public.organizations o
  JOIN public.site_settings s ON s.organization_id=o.id
  ORDER BY o.created_at
  LIMIT 1;

  RETURN COALESCE(v_result,'{}'::jsonb);
END;
$$;
