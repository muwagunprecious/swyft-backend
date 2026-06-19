import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function migrate() {
  console.log('Running migration: add university column to User table...');

  // Use Supabase's rpc to run raw SQL
  const { error } = await supabase.rpc('exec_sql', {
    sql: `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS university TEXT;`
  });

  if (error) {
    // Try alternative approach - directly query
    console.warn('RPC approach failed:', error.message);
    console.log('Trying direct update approach...');
    
    // Test if column already exists by reading a user
    const { data: testUser } = await supabase.from('User').select('university').limit(1);
    if (testUser !== null) {
      console.log('✅ university column already exists or was added!');
    } else {
      console.error('❌ Could not add column. Please run this SQL in your Supabase dashboard:');
      console.error('ALTER TABLE "User" ADD COLUMN IF NOT EXISTS university TEXT;');
    }
  } else {
    console.log('✅ Migration complete: university column added to User table');
  }
}

migrate().catch(console.error);
