import { supabase } from './config/supabase';

async function check() {
  const { data: eventCols, error: err1 } = await supabase.from('Event').select('*').limit(1);
  console.log('Event table sample:', eventCols || err1);

  const { data: ticketCols, error: err2 } = await supabase.from('Ticket').select('*').limit(1);
  console.log('Ticket table sample:', ticketCols || err2);
}

check();
