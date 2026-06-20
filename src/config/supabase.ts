import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

import fetch from 'cross-fetch';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn("⚠️ Missing SUPABASE_URL or SUPABASE_ANON_KEY environment variables!");
}

export const supabase = createClient(supabaseUrl || 'http://localhost', supabaseAnonKey || 'dummy', {
  auth: {
    persistSession: false,
  },
  global: {
    fetch: fetch,
  },
});
