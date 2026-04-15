import { createBrowserClient } from "@supabase/ssr";

let client: ReturnType<typeof createBrowserClient<any>> | null = null;

export function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY"
    );
  }

  if (!client) {
    client = createBrowserClient<any>(supabaseUrl, supabaseAnonKey);
  }

  return client;
}
