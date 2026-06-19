import { supabase } from './config/supabase';

async function run() {
  console.log("=== RECENT PAYMENTS ===");
  const { data: payments, error: pErr } = await supabase
    .from('Payment')
    .select('*, order:Order(*, user:User(*))')
    .order('createdAt', { ascending: false })
    .limit(5);

  if (pErr) {
    console.error("Error fetching payments:", pErr.message);
  } else {
    payments?.forEach((p: any) => {
      console.log(`Reference: ${p.reference}`);
      console.log(`  Amount: ₦${p.amount}`);
      console.log(`  Status: ${p.status}`);
      console.log(`  Order Status: ${p.order?.status}`);
      console.log(`  User: ${p.order?.user?.name} (${p.order?.user?.email})`);
      console.log("------------------------");
    });
  }
}

run().catch(console.error);
