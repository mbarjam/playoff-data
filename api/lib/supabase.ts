import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Service role client — bypasses RLS, only used in server-side API routes.
export const adminSupabase = createClient(supabaseUrl, serviceRoleKey);
