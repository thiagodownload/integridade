import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL?.trim()
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()

const initialHash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : ''
const initialAuthParams = new URLSearchParams(initialHash)

export const initialAuthFlow = initialAuthParams.get('type')
export const supabaseConfigured = Boolean(url && publishableKey)

export const supabase: SupabaseClient | null = supabaseConfigured
  ? createClient(url!, publishableKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null
