import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import ws from 'ws';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn("⚠️ Missing SUPABASE_URL or SUPABASE_ANON_KEY environment variables!");
}

export const supabase = createClient(supabaseUrl || 'http://localhost', supabaseAnonKey || 'dummy', {
  realtime: {
    transport: ws as any,
    params: {
      eventsPerSecond: 10,
    },
  },
  auth: {
    persistSession: false,
  },
  global: {
    fetch: (url, options = {}) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timeoutId));
    },
  },
});
