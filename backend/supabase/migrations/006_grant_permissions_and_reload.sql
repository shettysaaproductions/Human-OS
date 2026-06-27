-- PATCH: Fix PostgREST Schema Cache & Permissions
-- 1. Grant explicit privileges to the service_role and anon roles.
-- This ensures PostgREST can "see" the tables and stops throwing PGRST205.
GRANT ALL PRIVILEGES ON TABLE public.profiles TO postgres, anon, authenticated, service_role;
GRANT ALL PRIVILEGES ON TABLE public.chat_history TO postgres, anon, authenticated, service_role;

-- 2. Force schema reload explicitly.
NOTIFY pgrst, 'reload schema';
