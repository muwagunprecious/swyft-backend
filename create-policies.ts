import { Client } from 'pg';

const client = new Client({
  connectionString: 'postgresql://postgres.azauqcnijpdptlvxyapu:vFrNTBUnYB94oz0Y@aws-0-us-east-1.pooler.supabase.com:5432/postgres',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  try {
    await client.connect();
    
    console.log('Connected directly to Supabase on port 5432');
    
    // Create bucket if it doesn't exist just to be sure
    await client.query(`
      INSERT INTO storage.buckets (id, name, public)
      VALUES ('event-banners', 'event-banners', true)
      ON CONFLICT (id) DO UPDATE SET public = true;
    `);
    
    console.log('Bucket ensured');

    // Create INSERT policy
    await client.query(`
      DROP POLICY IF EXISTS "Allow public uploads" ON storage.objects;
      CREATE POLICY "Allow public uploads" ON storage.objects FOR INSERT TO public WITH CHECK (bucket_id = 'event-banners');
    `);
    
    // Create SELECT policy
    await client.query(`
      DROP POLICY IF EXISTS "Allow public reads" ON storage.objects;
      CREATE POLICY "Allow public reads" ON storage.objects FOR SELECT TO public USING (bucket_id = 'event-banners');
    `);
    
    // Create UPDATE policy (just in case they overwrite)
    await client.query(`
      DROP POLICY IF EXISTS "Allow public updates" ON storage.objects;
      CREATE POLICY "Allow public updates" ON storage.objects FOR UPDATE TO public USING (bucket_id = 'event-banners');
    `);

    console.log('Policies created successfully!');
  } catch (e) {
    console.error('Database error:', e);
  } finally {
    await client.end();
  }
}

run();
