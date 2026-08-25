-- Canal de Integridade v0.25
-- A tabela legada report_permissions permanece inacessivel ao frontend.

DROP POLICY IF EXISTS "report permissions deny authenticated" ON public.report_permissions;
CREATE POLICY "report permissions deny authenticated"
ON public.report_permissions
FOR ALL
TO authenticated
USING (false)
WITH CHECK (false);

DROP POLICY IF EXISTS "report permissions deny anon" ON public.report_permissions;
CREATE POLICY "report permissions deny anon"
ON public.report_permissions
FOR ALL
TO anon
USING (false)
WITH CHECK (false);
