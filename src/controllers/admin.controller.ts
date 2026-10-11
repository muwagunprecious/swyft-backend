import { Response } from 'express';
import { supabase } from '../config/supabase';
import { AuthRequest } from '../middleware/auth.middleware';

// 1. Get Platform Statistics
export const getStats = async (req: AuthRequest, res: Response) => {
  try {
    // Users count
    const { data: users, error: usersErr } = await supabase.from('User').select('id');
    if (usersErr) throw usersErr;
    const totalUsers = users?.length || 0;

    // Events count
    const { data: events, error: eventsErr } = await supabase.from('Event').select('id, isSuspended');
    if (eventsErr) throw eventsErr;
    const totalEvents = events?.length || 0;
    const activeEvents = events?.filter((e: any) => !e.isSuspended).length || 0;

    // Tickets sold (sum of sold on all tickets)
    const { data: tickets, error: ticketsErr } = await supabase.from('Ticket').select('sold');
    if (ticketsErr) throw ticketsErr;
    const ticketsSold = (tickets || []).reduce((sum: number, t: any) => sum + (t.sold || 0), 0);

    // Total Revenue (completed payments amount)
    const { data: payments, error: paymentsErr } = await supabase.from('Payment').select('amount').eq('status', 'SUCCESSFUL');
    if (paymentsErr) throw paymentsErr;
    const totalRevenue = (payments || []).reduce((sum: number, p: any) => sum + p.amount, 0);

    // Payout metrics
    const { data: payouts, error: payoutsErr } = await supabase.from('Payout').select('amount, status');
    if (payoutsErr) throw payoutsErr;
    const pendingPayoutsVal = (payouts || [])
      .filter((p: any) => p.status === 'PENDING')
      .reduce((sum: number, p: any) => sum + p.amount, 0);
    const completedPayoutsVal = (payouts || [])
      .filter((p: any) => p.status === 'COMPLETED')
      .reduce((sum: number, p: any) => sum + p.amount, 0);

    // Recent orders/transactions
    const { data: recentOrders, error: ordersErr } = await supabase
      .from('Order')
      .select('*')
      .order('createdAt', { ascending: false })
      .limit(8);
    if (ordersErr) throw ordersErr;

    res.status(200).json({
      stats: {
        totalUsers,
        totalEvents,
        activeEvents,
        ticketsSold,
        totalRevenue,
        pendingPayouts: pendingPayoutsVal,
        completedPayouts: completedPayoutsVal,
      },
      recentOrders: recentOrders || [],
    });
  } catch (error: any) {
    console.error('Error fetching admin stats:', error);
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};

// 2. Get Users Directory
export const getUsers = async (req: AuthRequest, res: Response) => {
  try {
    const { data: users, error } = await supabase
      .from('User')
      .select('id, name, email, role, university, phone, isVerified, isBanned, walletBalance, bankName, accountNumber, bankCode, subaccountCode, createdAt')
      .order('createdAt', { ascending: false });

    if (error) throw error;

    res.status(200).json(users || []);
  } catch (error: any) {
    console.error('Error fetching admin users:', error);
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};

// 2b. Get Organizers & Wallets Directory (Dynamic Live Wallet Calculation & Bank Account Sync)
export const getOrganizersDirectory = async (req: AuthRequest, res: Response) => {
  try {
    // 1. Fetch all users
    const { data: users, error: usersErr } = await supabase
      .from('User')
      .select('id, name, email, role, university, phone, isVerified, isBanned, walletBalance, bankName, accountNumber, bankCode, subaccountCode, createdAt')
      .order('createdAt', { ascending: false });

    if (usersErr) throw usersErr;

    // 2. Fetch all events, tickets, completed order items, and payouts in parallel
    const [eventsRes, ticketsRes, completedItemsRes, payoutsRes] = await Promise.all([
      supabase.from('Event').select('id, title, organizerId'),
      supabase.from('Ticket').select('id, name, price, sold, eventId'),
      supabase.from('OrderItem').select('id, quantity, ticketId, ticket:Ticket(id, price, eventId), order:Order!inner(status)').eq('order.status', 'COMPLETED'),
      supabase.from('Payout').select('*').order('createdAt', { ascending: false }),
    ]);

    const events = eventsRes.data || [];
    const tickets = ticketsRes.data || [];
    const completedItems = completedItemsRes.data || [];
    const payouts = payoutsRes.data || [];

    // Map events by organizer
    const eventsByOrg: Record<string, any[]> = {};
    for (const ev of events) {
      if (!eventsByOrg[ev.organizerId]) eventsByOrg[ev.organizerId] = [];
      eventsByOrg[ev.organizerId].push(ev);
    }

    // Map ticket sold revenue by organizer (sold * price)
    const ticketRevByOrg: Record<string, number> = {};
    for (const t of tickets) {
      const ev = events.find((e: any) => e.id === t.eventId);
      if (ev && ev.organizerId) {
        ticketRevByOrg[ev.organizerId] = (ticketRevByOrg[ev.organizerId] || 0) + ((t.sold || 0) * (t.price || 0));
      }
    }

    // Map completed order item revenue by organizer (quantity * ticket.price)
    const itemRevByOrg: Record<string, number> = {};
    for (const item of completedItems) {
      const t = item.ticket as any;
      if (t && t.eventId) {
        const ev = events.find((e: any) => e.id === t.eventId);
        if (ev && ev.organizerId) {
          const itemTotal = (t.price || 0) * (item.quantity || 1);
          itemRevByOrg[ev.organizerId] = (itemRevByOrg[ev.organizerId] || 0) + itemTotal;
        }
      }
    }

    // Map payouts by user
    const payoutsByUser: Record<string, any[]> = {};
    for (const p of payouts) {
      if (!payoutsByUser[p.userId]) payoutsByUser[p.userId] = [];
      payoutsByUser[p.userId].push(p);
    }

    const organizersList: any[] = [];
    const syncUpdates: Promise<any>[] = [];

    for (const u of (users || [])) {
      const userEvents = eventsByOrg[u.id] || [];
      const userPayouts = payoutsByUser[u.id] || [];

      // Ground truth revenue: take max of completed OrderItems revenue and ticket.sold revenue
      const tRev = ticketRevByOrg[u.id] || 0;
      const iRev = itemRevByOrg[u.id] || 0;
      const totalRevenue = Math.max(tRev, iRev);

      const completedPayouts = userPayouts.filter((p: any) => p.status === 'COMPLETED');
      const pendingPayouts = userPayouts.filter((p: any) => p.status === 'PENDING');

      const totalWithdrawn = completedPayouts.reduce((sum: number, p: any) => sum + (p.amount || 0), 0);
      const pendingWithdrawals = pendingPayouts.reduce((sum: number, p: any) => sum + (p.amount || 0), 0);

      // Real live available balance: total revenue minus withdrawn and pending
      const realCalculatedBalance = Math.max(0, totalRevenue - totalWithdrawn - pendingWithdrawals);
      const currentStoredBalance = typeof u.walletBalance === 'number' ? u.walletBalance : 0;
      const effectiveWalletBalance = Math.max(currentStoredBalance, realCalculatedBalance);

      // Bank account resolution:
      // Priority 1: User's saved bank account in User table
      let bankName = (u.bankName || '').trim();
      let accountNumber = (u.accountNumber || '').trim();

      // Priority 2: Fallback to any past Payout request submitted by the organizer
      if (!accountNumber || accountNumber === 'Not Provided' || accountNumber === 'Not Set' || accountNumber === '—') {
        const payoutWithAccount = userPayouts.find((p: any) => p.accountNumber && String(p.accountNumber).trim() !== '');
        if (payoutWithAccount) {
          accountNumber = String(payoutWithAccount.accountNumber).trim();
          if (!bankName || bankName === 'Not Provided' || bankName === 'Not Set') {
            bankName = String(payoutWithAccount.bankName || '').trim();
          }
          // Self-heal: update User profile in database so it reflects permanently
          syncUpdates.push(
            Promise.resolve(supabase.from('User').update({ bankName, accountNumber }).eq('id', u.id))
          );
        }
      }

      // Sync User.walletBalance in database if calculated balance is higher than stored
      if (realCalculatedBalance > currentStoredBalance) {
        syncUpdates.push(
          Promise.resolve(supabase.from('User').update({ walletBalance: effectiveWalletBalance }).eq('id', u.id))
        );
      }

      // Check if user should be listed in Organizers Directory:
      const isOrganizer =
        u.role === 'ORGANIZER' ||
        userEvents.length > 0 ||
        totalRevenue > 0 ||
        effectiveWalletBalance > 0 ||
        (accountNumber && accountNumber !== 'Not Provided' && accountNumber !== 'Not Set') ||
        userPayouts.length > 0;

      if (isOrganizer) {
        organizersList.push({
          id: u.id,
          name: u.name || 'Unnamed Organizer',
          email: u.email,
          phone: u.phone || 'N/A',
          role: u.role,
          university: u.university || 'N/A',
          isBanned: u.isBanned || false,
          createdAt: u.createdAt,
          walletBalance: effectiveWalletBalance,
          totalRevenue,
          totalWithdrawn,
          pendingWithdrawals,
          bankName: bankName || 'Not Provided',
          accountNumber: accountNumber || 'Not Provided',
          bankCode: u.bankCode || '',
          subaccountCode: u.subaccountCode || '',
          eventsCount: userEvents.length,
          events: userEvents,
          recentPayouts: userPayouts.slice(0, 3),
        });
      }
    }

    // Execute background syncs non-blockingly
    if (syncUpdates.length > 0) {
      Promise.allSettled(syncUpdates).catch(err => console.warn('Directory auto-sync warning:', err));
    }

    res.status(200).json(organizersList);
  } catch (error: any) {
    console.error('Error fetching organizers directory:', error);
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};

// 2c. Admin Update Organizer Bank Account Details
export const updateOrganizerBankDetails = async (req: AuthRequest, res: Response) => {
  try {
    const { userId } = req.params;
    const { bankName, accountNumber, bankCode } = req.body;

    if (!bankName || !accountNumber) {
      return res.status(400).json({ message: 'Bank name and account number are required' });
    }

    let cleanAccount = String(accountNumber).trim().replace(/\D/g, '');
    if (cleanAccount.length === 11 && cleanAccount.startsWith('0')) {
      cleanAccount = cleanAccount.substring(1);
    }

    if (cleanAccount.length !== 10) {
      return res.status(400).json({ message: 'Please enter a valid 10-digit account number' });
    }

    const { data: updatedUser, error: updateErr } = await supabase
      .from('User')
      .update({
        bankName: String(bankName).trim(),
        accountNumber: cleanAccount,
        bankCode: bankCode ? String(bankCode).trim() : null,
        updatedAt: new Date().toISOString(),
      })
      .eq('id', userId)
      .select('id, name, email, bankName, accountNumber, bankCode, walletBalance')
      .single();

    if (updateErr) throw updateErr;

    res.status(200).json({
      message: 'Organizer bank details updated and saved successfully.',
      user: updatedUser,
    });
  } catch (error: any) {
    console.error('Error updating organizer bank details:', error);
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};

// 2d. Admin Update / Adjust Organizer Wallet Balance
export const updateOrganizerWallet = async (req: AuthRequest, res: Response) => {
  try {
    const { userId } = req.params;
    const { walletBalance } = req.body;

    const numBal = Number(walletBalance);
    if (isNaN(numBal) || numBal < 0) {
      return res.status(400).json({ message: 'Please provide a valid positive wallet balance amount.' });
    }

    const { data: updatedUser, error: updateErr } = await supabase
      .from('User')
      .update({
        walletBalance: numBal,
        updatedAt: new Date().toISOString(),
      })
      .eq('id', userId)
      .select('id, name, email, walletBalance')
      .single();

    if (updateErr) throw updateErr;

    res.status(200).json({
      message: `Organizer wallet balance updated to ₦${numBal.toLocaleString()}.`,
      user: updatedUser,
    });
  } catch (error: any) {
    console.error('Error updating organizer wallet balance:', error);
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};

// 3. Toggle User Ban Status
export const toggleBan = async (req: AuthRequest, res: Response) => {
  try {
    const { userId } = req.params;

    if (userId === req.user?.userId) {
      return res.status(400).json({ message: 'You cannot ban your own administrative account.' });
    }

    const { data: user, error: fetchErr } = await supabase
      .from('User')
      .select('id, isBanned')
      .eq('id', userId)
      .single();

    if (fetchErr || !user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const nextBanState = !user.isBanned;

    const { data: updatedUser, error: updateErr } = await supabase
      .from('User')
      .update({ isBanned: nextBanState })
      .eq('id', userId)
      .select('id, name, email, isBanned')
      .single();

    if (updateErr) throw updateErr;

    res.status(200).json({
      message: `User account has been ${nextBanState ? 'suspended' : 're-activated'}.`,
      user: updatedUser,
    });
  } catch (error: any) {
    console.error('Error toggling user ban status:', error);
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};

// 4. Get Events List
export const getEvents = async (req: AuthRequest, res: Response) => {
  try {
    const { data: events, error } = await supabase
      .from('Event')
      .select('*, organizer:User(name)')
      .order('date', { ascending: true });

    if (error) throw error;

    res.status(200).json(events || []);
  } catch (error: any) {
    console.error('Error fetching admin events:', error);
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};

// 5. Toggle Event Deactivation (Bring Down / Suspend Event)
export const toggleEventStatus = async (req: AuthRequest, res: Response) => {
  try {
    const { eventId } = req.params;

    const { data: event, error: fetchErr } = await supabase
      .from('Event')
      .select('id, isSuspended')
      .eq('id', eventId)
      .single();

    if (fetchErr || !event) {
      return res.status(404).json({ message: 'Event not found' });
    }

    const nextSuspendState = !event.isSuspended;

    const { data: updatedEvent, error: updateErr } = await supabase
      .from('Event')
      .update({ isSuspended: nextSuspendState })
      .eq('id', eventId)
      .select('id, title, isSuspended')
      .single();

    if (updateErr) throw updateErr;

    res.status(200).json({
      message: `Event has been successfully ${nextSuspendState ? 'suspended/brought down' : 'activated'}.`,
      event: updatedEvent,
    });
  } catch (error: any) {
    console.error('Error toggling event suspension:', error);
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};

// 6. Get Payout Requests
export const getPayouts = async (req: AuthRequest, res: Response) => {
  try {
    const { data: payouts, error } = await supabase
      .from('Payout')
      .select('*, user:User(id, name, email, phone, bankName, accountNumber)')
      .order('createdAt', { ascending: false });

    if (error) throw error;

    const formatted = (payouts || []).map((p: any) => ({
      id: p.id,
      amount: p.amount,
      status: p.status,
      bankName: p.bankName || p.user?.bankName || 'Bank Transfer',
      accountNumber: p.accountNumber || p.user?.accountNumber || '—',
      accountName: p.accountName || p.user?.name || 'Organizer',
      organizerName: p.user?.name || p.accountName || 'Unknown Organizer',
      organizerEmail: p.user?.email || 'N/A',
      organizerPhone: p.user?.phone || 'N/A',
      reference: p.reference || p.id,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    }));

    res.status(200).json(formatted);
  } catch (error: any) {
    console.error('Error fetching admin payouts:', error);
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};

// 7. Release Payout Request (Approve & Pay)
export const releasePayout = async (req: AuthRequest, res: Response) => {
  try {
    const { payoutId } = req.params;

    const { data: payout, error: fetchErr } = await supabase
      .from('Payout')
      .select('id, userId, amount, status')
      .eq('id', payoutId)
      .single();

    if (fetchErr || !payout) {
      return res.status(404).json({ message: 'Payout request not found' });
    }

    if (payout.status === 'COMPLETED') {
      return res.status(400).json({ message: 'This payout request has already been released.' });
    }

    const { data: updatedPayout, error: updateErr } = await supabase
      .from('Payout')
      .update({ status: 'COMPLETED', updatedAt: new Date().toISOString() })
      .eq('id', payoutId)
      .select('*')
      .single();

    if (updateErr) throw updateErr;

    // Immediately deduct amount from organizer's wallet balance in User table
    if (payout.userId && payout.amount) {
      const { data: user } = await supabase
        .from('User')
        .select('walletBalance')
        .eq('id', payout.userId)
        .single();

      const currentBalance = typeof user?.walletBalance === 'number' ? user.walletBalance : 0;
      const newBalance = Math.max(0, currentBalance - (payout.amount || 0));

      await supabase
        .from('User')
        .update({ walletBalance: newBalance })
        .eq('id', payout.userId);

      console.log(`💸 Payout ₦${payout.amount} released for organizer ${payout.userId}. Wallet balance updated: ₦${currentBalance} -> ₦${newBalance}`);
    }

    res.status(200).json({
      message: 'Payout successfully released and approved. The amount has been withdrawn from the organizer wallet.',
      payout: updatedPayout,
    });
  } catch (error: any) {
    console.error('Error releasing payout:', error);
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};

// 7b. Reject Payout Request
export const rejectPayout = async (req: AuthRequest, res: Response) => {
  try {
    const { payoutId } = req.params;
    const { note } = req.body || {};

    const { data: payout, error: fetchErr } = await supabase
      .from('Payout')
      .select('id, userId, amount, status')
      .eq('id', payoutId)
      .single();

    if (fetchErr || !payout) {
      return res.status(404).json({ message: 'Payout request not found' });
    }

    if (payout.status !== 'PENDING') {
      return res.status(400).json({ message: `Cannot reject payout that is already ${payout.status}.` });
    }

    const { data: updatedPayout, error: updateErr } = await supabase
      .from('Payout')
      .update({ status: 'REJECTED', note: note || 'Rejected by administrator', updatedAt: new Date().toISOString() })
      .eq('id', payoutId)
      .select('*')
      .single();

    if (updateErr) throw updateErr;

    res.status(200).json({
      message: 'Payout request rejected.',
      payout: updatedPayout,
    });
  } catch (error: any) {
    console.error('Error rejecting payout:', error);
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};

// 8. Get Ticket / Order Audit Logs
export const getTickets = async (req: AuthRequest, res: Response) => {
  try {
    const { data: orders, error } = await supabase
      .from('Order')
      .select('*')
      .order('createdAt', { ascending: false });

    if (error) throw error;

    // Flatten all completed order items for easy listing
    const ticketLogs: any[] = [];
    
    for (const order of (orders || [])) {
      if (order.orderItems && order.orderItems.length > 0) {
        for (const item of order.orderItems) {
          ticketLogs.push({
            id: item.id,
            orderId: order.id,
            userId: order.userId,
            userName: order.user?.name || 'Guest User',
            userEmail: order.user?.email || 'guest@swyft.com',
            eventTitle: item.ticket?.event?.title || 'Unknown Event',
            ticketName: item.ticket?.name || 'General Admission',
            ticketPrice: item.ticket?.price || 0,
            quantity: item.quantity,
            totalPaid: (item.ticket?.price || 0) * item.quantity,
            qrCode: item.qrCode,
            isUsed: item.isUsed || false,
            orderStatus: order.status,
            createdAt: order.createdAt,
          });
        }
      }
    }

    res.status(200).json(ticketLogs);
  } catch (error: any) {
    console.error('Error fetching admin tickets audit logs:', error);
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};

// 9. Get User Audit Trail (Aggregated Activities)
export const getUserAuditTrail = async (req: AuthRequest, res: Response) => {
  try {
    const { userId } = req.params;

    // Fetch user details to get their email (for free votes matching)
    const { data: user, error: userErr } = await supabase
      .from('User')
      .select('email, role')
      .eq('id', userId)
      .single();

    if (userErr || !user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const activities: any[] = [];

    // 1. Fetch Orders (Ticket Purchases)
    const { data: orders } = await supabase
      .from('Order')
      .select('*, items:OrderItem(*, ticket:Ticket(name, event:Event(title)))')
      .eq('userId', userId);
    
    if (orders) {
      for (const order of orders) {
        if (order.items) {
          for (const item of order.items) {
            activities.push({
              id: item.id,
              type: 'TICKET_PURCHASE',
              title: `Purchased Ticket: ${item.ticket?.name || 'Unknown'} for ${item.ticket?.event?.title || 'Unknown Event'}`,
              amount: (item.ticket?.price || 0) * item.quantity,
              quantity: item.quantity,
              date: order.createdAt
            });
          }
        }
      }
    }

    // 2. Fetch Real Votes (Matched by email)
    const { data: votes } = await supabase
      .from('Vote')
      .select('id, createdAt, category:VoteCategory(name, event:Event(title)), contestant:Contestant(name)')
      .eq('email', user.email)
      .eq('isTweaked', false);

    if (votes) {
      for (const vote of votes as any[]) {
        const contestant = Array.isArray(vote.contestant) ? vote.contestant[0] : vote.contestant;
        const category = Array.isArray(vote.category) ? vote.category[0] : vote.category;
        const event = category ? (Array.isArray(category.event) ? category.event[0] : category.event) : null;
        activities.push({
          id: vote.id,
          type: 'VOTE_CAST',
          title: `Cast Vote for ${contestant?.name || 'Unknown'}`,
          description: `Event: ${event?.title || 'Unknown'} | Category: ${category?.name || 'Unknown'}`,
          date: vote.createdAt
        });
      }
    }

    // 3. If Organizer, fetch Tweaked Votes (Matched by userId)
    if (user.role === 'ORGANIZER' || user.role === 'ADMIN') {
      const { data: tweaks } = await supabase
        .from('Vote')
        .select('id, createdAt, category:VoteCategory(name, event:Event(title)), contestant:Contestant(name)')
        .eq('userId', userId)
        .eq('isTweaked', true);

      if (tweaks) {
        const groupedTweaks: Record<string, any> = {};
        for (const tweak of tweaks as any[]) {
          const contestant = Array.isArray(tweak.contestant) ? tweak.contestant[0] : tweak.contestant;
          const category = Array.isArray(tweak.category) ? tweak.category[0] : tweak.category;
          const event = category ? (Array.isArray(category.event) ? category.event[0] : category.event) : null;
          const minString = new Date(tweak.createdAt).toISOString().substring(0, 16);
          const key = `${contestant?.name}-${minString}`;
          if (!groupedTweaks[key]) {
            groupedTweaks[key] = {
              id: tweak.id,
              type: 'VOTE_ALTERED',
              count: 0,
              contestantName: contestant?.name || 'Unknown',
              eventName: event?.title || 'Unknown',
              categoryName: category?.name || 'Unknown',
              date: tweak.createdAt
            };
          }
          groupedTweaks[key].count += 1;
        }

        for (const group of Object.values(groupedTweaks)) {
          activities.push({
            id: group.id,
            type: 'VOTE_ALTERED',
            title: `Injected ${group.count} Fake Votes for ${group.contestantName}`,
            description: `Event: ${group.eventName} | Category: ${group.categoryName}`,
            date: group.date
          });
        }
      }

      // 4. Events Created
      const { data: events } = await supabase
        .from('Event')
        .select('id, title, createdAt')
        .eq('organizerId', userId);
      
      if (events) {
        for (const evt of events) {
          activities.push({
            id: evt.id,
            type: 'EVENT_CREATED',
            title: `Created Event: ${evt.title}`,
            date: evt.createdAt
          });
        }
      }
    }

    activities.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    res.status(200).json(activities);
  } catch (error: any) {
    console.error('Error fetching user audit trail:', error);
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};
