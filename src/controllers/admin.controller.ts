import { Response } from 'express';
import { supabase } from '../config/supabase';
import { AuthRequest } from '../middleware/auth.middleware';
import { sendOrganizerTicketSaleNotification } from '../services/email.service';

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

    // 2. Fetch all events, tickets, completed orders (with user details and items), and payouts in parallel
    const [eventsRes, ticketsRes, completedOrdersRes, payoutsRes] = await Promise.all([
      supabase.from('Event').select('id, title, organizerId'),
      supabase.from('Ticket').select('id, name, price, discountPrice, discountEndsAt, sold, eventId'),
      supabase.from('Order').select('id, totalPrice, status, createdAt, userId, user:User(id, name, email, phone), items:OrderItem(id, quantity, qrCode, ticket:Ticket(id, name, price, discountPrice, discountEndsAt, eventId, event:Event(id, title, organizerId)))').eq('status', 'COMPLETED'),
      supabase.from('Payout').select('*').order('createdAt', { ascending: false }),
    ]);

    const events = eventsRes.data || [];
    const tickets = ticketsRes.data || [];
    const completedOrders = completedOrdersRes.data || [];
    const payouts = payoutsRes.data || [];

    // Map events by organizer
    const eventsByOrg: Record<string, any[]> = {};
    for (const ev of events) {
      if (!eventsByOrg[ev.organizerId]) eventsByOrg[ev.organizerId] = [];
      eventsByOrg[ev.organizerId].push(ev);
    }

    // Map completed orders, exact revenue, tickets sold, and buyer details by organizer
    const revByOrg: Record<string, number> = {};
    const ticketsSoldByOrg: Record<string, number> = {};
    const buyersByOrg: Record<string, any[]> = {};

    for (const ord of (completedOrders as any[])) {
      const ordUser = Array.isArray(ord.user) ? ord.user[0] : (ord.user || {});
      // Group items in this order by organizer
      const itemsByOrgInOrder: Record<string, any[]> = {};
      for (const item of (ord.items || [])) {
        const ticket = Array.isArray(item.ticket) ? item.ticket[0] : (item.ticket || {});
        const event = Array.isArray(ticket.event) ? ticket.event[0] : (ticket.event || {});
        const orgId = event.organizerId;
        if (orgId) {
          if (!itemsByOrgInOrder[orgId]) itemsByOrgInOrder[orgId] = [];
          itemsByOrgInOrder[orgId].push({ item, ticket, event });
        }
      }

      for (const [orgId, orderOrgItems] of Object.entries(itemsByOrgInOrder)) {
        // Exactly credit the actual order totalPrice paid by the buyer (handles discounts, free tickets, normal prices)
        revByOrg[orgId] = (revByOrg[orgId] || 0) + (ord.totalPrice || 0);

        for (const entry of orderOrgItems) {
          const { item, ticket, event } = entry;
          ticketsSoldByOrg[orgId] = (ticketsSoldByOrg[orgId] || 0) + (item.quantity || 1);

          if (!buyersByOrg[orgId]) buyersByOrg[orgId] = [];
          buyersByOrg[orgId].push({
            orderId: ord.id,
            buyerName: ordUser.name || 'Guest Attendee',
            buyerEmail: ordUser.email || 'N/A',
            buyerPhone: ordUser.phone || 'N/A',
            ticketName: ticket.name || 'General Admission',
            eventTitle: event.title || 'Unknown Event',
            quantity: item.quantity || 1,
            pricePaid: orderOrgItems.length === 1 ? ord.totalPrice : Math.round(ord.totalPrice / orderOrgItems.length),
            totalOrderPaid: ord.totalPrice,
            createdAt: ord.createdAt,
            qrCode: item.qrCode,
          });
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
      const userBuyers = buyersByOrg[u.id] || [];
      const userTicketsSold = ticketsSoldByOrg[u.id] || 0;

      // Ground truth revenue: actual exact paid amounts from completed orders
      const totalRevenue = revByOrg[u.id] || 0;

      const completedPayouts = userPayouts.filter((p: any) => p.status === 'COMPLETED');
      const pendingPayouts = userPayouts.filter((p: any) => p.status === 'PENDING');

      const totalWithdrawn = completedPayouts.reduce((sum: number, p: any) => sum + (p.amount || 0), 0);
      const pendingWithdrawals = pendingPayouts.reduce((sum: number, p: any) => sum + (p.amount || 0), 0);

      // Real live available balance: exact revenue minus completed withdrawals and pending requests
      const realCalculatedBalance = Math.max(0, totalRevenue - totalWithdrawn - pendingWithdrawals);
      const effectiveWalletBalance = realCalculatedBalance;

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

      // Sync User.walletBalance in database if DB differs from exact calculated balance
      if (u.walletBalance !== effectiveWalletBalance) {
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
          ticketsSold: userTicketsSold,
          buyers: userBuyers,
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

/**
 * 13. Resend organizer sale notifications for all past completed orders in the database
 */
export const resendPastSalesToOrganizers = async (req: AuthRequest, res: Response) => {
  try {
    const { data: orders, error } = await supabase
      .from('Order')
      .select('id, totalPrice, status, createdAt, user:User(*), payment:Payment(*), orderItems:OrderItem(*, ticket:Ticket(*, event:Event(*, organizer:User(*))))')
      .eq('status', 'COMPLETED');

    if (error) throw error;

    let dispatchedCount = 0;
    const results: any[] = [];

    for (const order of (orders || [])) {
      const buyer = Array.isArray(order.user) ? order.user[0] : order.user;
      const paymentRecord = Array.isArray(order.payment) ? order.payment[0] : order.payment;
      const ref = paymentRecord?.reference || `ORD-${order.id.substring(0, 8)}`;
      const orderItems = order.orderItems || [];

      for (const item of orderItems) {
        const ticket = item.ticket;
        const event = ticket?.event;
        const organizer = Array.isArray(event?.organizer) ? event?.organizer[0] : event?.organizer;

        if (organizer && organizer.email) {
          const exactPrice = orderItems.length === 1
            ? order.totalPrice
            : Math.round(order.totalPrice / orderItems.length);

          try {
            await sendOrganizerTicketSaleNotification({
              organizerEmail: organizer.email,
              organizerName: organizer.name || 'Organizer',
              eventTitle: event?.title || 'Event',
              buyerName: buyer?.name || 'Guest Attendee',
              buyerEmail: buyer?.email,
              buyerPhone: buyer?.phone || undefined,
              ticketName: ticket?.name || 'General Admission',
              quantity: item.quantity || 1,
              pricePaid: exactPrice,
              totalOrderPrice: order.totalPrice,
              orderReference: ref,
              orderId: order.id,
              purchaseDate: order.createdAt
                ? new Date(order.createdAt).toLocaleDateString('en-US', {
                    weekday: 'short',
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                : undefined,
            });

            dispatchedCount++;
            results.push({
              orderId: order.id,
              organizerEmail: organizer.email,
              event: event?.title,
              buyer: buyer?.name,
              pricePaid: exactPrice,
              status: 'sent',
            });

            // Brief throttle between emails to respect SMTP / Resend rate limits
            await new Promise((r) => setTimeout(r, 1200));
          } catch (err: any) {
            console.error(`Failed to send email to organizer ${organizer.email} for order ${order.id}:`, err);
            results.push({
              orderId: order.id,
              organizerEmail: organizer.email,
              status: 'failed',
              error: err.message,
            });
          }
        }
      }
    }

    res.status(200).json({
      message: `Successfully processed and resent notifications for ${dispatchedCount} ticket sales.`,
      dispatchedCount,
      details: results,
    });
  } catch (err: any) {
    console.error('Error resending past sales notifications:', err);
    res.status(500).json({ message: 'Internal server error', error: err.message });
  }
};

