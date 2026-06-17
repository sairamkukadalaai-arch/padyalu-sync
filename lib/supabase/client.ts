import { createBrowserClient } from "@supabase/ssr";

// Used from "use client" components (the main practice app, login form).
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
