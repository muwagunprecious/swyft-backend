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
      .select('id, name, email, role, university, phone, isVerified, isBanned, createdAt')
      .order('createdAt', { ascending: false });

    if (error) throw error;

    res.status(200).json(users || []);
  } catch (error: any) {
    console.error('Error fetching admin users:', error);
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
      .select('*')
      .order('createdAt', { ascending: false });

    if (error) throw error;

    res.status(200).json(payouts || []);
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
      .select('id, status')
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

    res.status(200).json({
      message: 'Payout successfully released.',
      payout: updatedPayout,
    });
  } catch (error: any) {
    console.error('Error releasing payout:', error);
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
      for (const vote of votes) {
        activities.push({
          id: vote.id,
          type: 'VOTE_CAST',
          title: `Cast Vote for ${vote.contestant?.name || 'Unknown'}`,
          description: `Event: ${vote.category?.event?.title || 'Unknown'} | Category: ${vote.category?.name || 'Unknown'}`,
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
        for (const tweak of tweaks) {
          const minString = new Date(tweak.createdAt).toISOString().substring(0, 16); // Group by YYYY-MM-DDTHH:mm
          const key = `${tweak.contestant?.name}-${minString}`;
          if (!groupedTweaks[key]) {
            groupedTweaks[key] = {
              id: tweak.id,
              type: 'VOTE_ALTERED',
              count: 0,
              contestantName: tweak.contestant?.name || 'Unknown',
              eventName: tweak.category?.event?.title || 'Unknown',
              categoryName: tweak.category?.name || 'Unknown',
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
