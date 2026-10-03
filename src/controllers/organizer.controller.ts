import { Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { supabase } from '../config/supabase';
import { AuthRequest } from '../middleware/auth.middleware';
import { sendOrderReceiptEmail, sendTicketPassEmail } from '../services/email.service';

// ─── ICON / COLOR MAPS (shared) ─────────────────────────────────────────────
const iconMap: Record<string, string> = {
  purchase: 'M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z',
  vote: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
  checkin: 'M5 13l4 4L19 7',
  event: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z'
};
const colorMap: Record<string, string> = {
  purchase: 'text-indigo-600 bg-indigo-50',
  vote: 'text-amber-600 bg-amber-50',
  checkin: 'text-emerald-600 bg-emerald-50',
  event: 'text-blue-600 bg-blue-50'
};

function getRelativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const s = Math.floor(diffMs / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (s < 60) return 'Just now';
  if (m < 60) return `${m} min${m > 1 ? 's' : ''} ago`;
  if (h < 24) return `${h} hour${h > 1 ? 's' : ''} ago`;
  return `${d} day${d > 1 ? 's' : ''} ago`;
}

// ─── SINGLE COMBINED DASHBOARD ENDPOINT ──────────────────────
export const getDashboard = async (req: AuthRequest, res: Response) => {
  try {
    const organizerId = req.user?.userId;
    if (!organizerId) return res.status(401).json({ message: 'Unauthorized' });

    // 1. Fetch Events + Tickets (FAST)
    const { data: eventsRes } = await supabase
      .from('Event')
      .select('id, title, createdAt, Ticket(id, sold, price, quantity)')
      .eq('organizerId', organizerId);

    const events = eventsRes || [];
    const eventIds = events.map((e: any) => e.id);
    const ticketIds = events.flatMap((e: any) => e.Ticket?.map((t: any) => t.id) || []);

    if (eventIds.length === 0) {
      const { data: userRecord } = await supabase
        .from('User')
        .select('walletBalance')
        .eq('id', organizerId)
        .single();

      return res.status(200).json({ 
        stats: { revenue: 0, walletBalance: userRecord?.walletBalance || 0, withdrawnAmount: 0, pendingWithdrawals: 0, ticketsSold: 0, totalVotes: 0, activeEvents: 0 }, 
        sales: [], 
        activity: [] 
      });
    }

    // Compute basic event stats
    let revenue = 0, ticketsSold = 0;
    events.forEach((e: any) => {
      (e.Ticket || []).forEach((t: any) => {
        ticketsSold += t.sold || 0;
        revenue += (t.sold || 0) * (t.price || 0);
      });
    });

    // Fetch payouts to calculate net wallet balance
    const { data: payouts } = await supabase
      .from('Payout')
      .select('amount, status')
      .eq('userId', organizerId);

    let withdrawnAmount = 0;
    let pendingWithdrawals = 0;
    (payouts || []).forEach((p: any) => {
      if (p.status === 'COMPLETED') withdrawnAmount += p.amount || 0;
      else if (p.status === 'PENDING') pendingWithdrawals += p.amount || 0;
    });

    const { data: userRecord } = await supabase
      .from('User')
      .select('walletBalance')
      .eq('id', organizerId)
      .single();

    const walletBalance = typeof userRecord?.walletBalance === 'number'
      ? userRecord.walletBalance
      : Math.max(0, revenue - withdrawnAmount - pendingWithdrawals);

    // Fetch VoteCategories to get categoryIds
    const { data: categories } = await supabase
      .from('VoteCategory')
      .select('id')
      .in('eventId', eventIds);
    const categoryIds = (categories || []).map((c: any) => c.id);

    // ── Fire secondary queries in parallel using ID lists ────────────────────
    const [totalVotesRes, salesRes, activityPurchasesRes, activityVotesRes] = await Promise.all([
      // A. Total Votes Count (head: true for performance, no data returned)
      categoryIds.length > 0 
        ? supabase.from('Vote').select('*', { count: 'exact', head: true }).in('categoryId', categoryIds)
        : Promise.resolve({ count: 0 }),

      // B. Recent sales for the sales table
      ticketIds.length > 0
        ? supabase.from('OrderItem')
            .select('id, order:Order(status, createdAt, user:User(name)), ticket:Ticket(name, price, eventId)')
            .in('ticketId', ticketIds)
            .order('id', { ascending: false })
            .limit(10)
        : Promise.resolve({ data: [] }),

      // C. Recent completed purchases for activity feed
      ticketIds.length > 0
        ? supabase.from('OrderItem')
            .select('id, quantity, ticket:Ticket(name, eventId), order:Order(createdAt, status, user:User(name))')
            .in('ticketId', ticketIds)
            .eq('order.status', 'COMPLETED')
            .order('id', { ascending: false })
            .limit(8)
        : Promise.resolve({ data: [] }),

      // D. Recent votes for activity feed
      categoryIds.length > 0
        ? supabase.from('Vote')
            .select('id, createdAt, contestant:Contestant(name), category:VoteCategory(name, eventId)')
            .in('categoryId', categoryIds)
            .order('createdAt', { ascending: false })
            .limit(8)
        : Promise.resolve({ data: [] }),
    ]);

    const totalVotes = totalVotesRes.count || 0;

    // Helper to find event title by ID
    const getEventTitle = (id: string) => events.find((e: any) => e.id === id)?.title || 'Unknown Event';

    // ── Build sales list ─────────────────────────────────────────────────────
    const sales = (salesRes.data || []).map((item: any) => ({
      id: item.id,
      user: { name: item.order?.user?.name || 'Unknown' },
      ticket: {
        type: item.ticket?.name || 'Ticket',
        price: item.ticket?.price || 0,
        event: { title: getEventTitle(item.ticket?.eventId) }
      },
      status: item.order?.status === 'COMPLETED' ? 'Paid' : 'Pending',
      createdAt: item.order?.createdAt
    }));

    // ── Build activity feed ──────────────────────────────────────────────────
    const activities: any[] = [];

    // Published events
    events.forEach((e: any) => {
      activities.push({
        id: `event-${e.id}`,
        type: 'event',
        text: `Event "${e.title}" published`,
        createdAt: new Date(e.createdAt || 0)
      });
    });

    // Completed purchases
    (activityPurchasesRes.data || []).forEach((item: any) => {
      activities.push({
        id: `purchase-${item.id}`,
        type: 'purchase',
        text: `${item.quantity} ${item.ticket?.name || 'ticket'}(s) purchased by ${item.order?.user?.name || 'Guest'} for "${getEventTitle(item.ticket?.eventId)}"`,
        createdAt: new Date(item.order?.createdAt || 0)
      });
    });

    // Votes
    (activityVotesRes.data || []).forEach((v: any) => {
      activities.push({
        id: `vote-${v.id}`,
        type: 'vote',
        text: `New vote for "${v.contestant?.name || 'Contestant'}" (${v.category?.name || 'Category'})`,
        createdAt: new Date(v.createdAt)
      });
    });

    const activity = activities
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 5)
      .map(act => ({
        id: act.id,
        type: act.type,
        text: act.text,
        time: getRelativeTime(act.createdAt),
        icon: iconMap[act.type] || '',
        color: colorMap[act.type] || ''
      }));

    // ── Single response ──────────────────────────────────────────────────────
    res.status(200).json({
      stats: {
        revenue,
        walletBalance,
        withdrawnAmount,
        pendingWithdrawals,
        ticketsSold,
        totalVotes,
        activeEvents: events.length,
      },
      sales,
      activity
    });
  } catch (error: any) {
    console.error('Dashboard error:', error);
    res.status(500).json({ message: 'Error loading dashboard', error: error.message });
  }
};

// ─── KEPT FOR BACKWARD COMPATIBILITY (organizer/events page) ────────────────
export const getStats = async (req: AuthRequest, res: Response) => {
  try {
    const organizerId = req.user?.userId;
    if (!organizerId) return res.status(401).json({ message: 'Unauthorized' });
    const { data: events, error } = await supabase
      .from('Event').select('*, Ticket(*), VoteCategory(*, Vote(id))').eq('organizerId', organizerId);
    if (error) throw error;
    let revenue = 0, ticketsSold = 0, totalVotes = 0;
    (events || []).forEach((event: any) => {
      (event.Ticket || []).forEach((t: any) => { ticketsSold += t.sold || 0; revenue += (t.sold || 0) * (t.price || 0); });
      (event.VoteCategory || []).forEach((vc: any) => { totalVotes += (vc.Vote || []).length; });
    });

    const { data: payouts } = await supabase
      .from('Payout')
      .select('amount, status')
      .eq('userId', organizerId);

    let withdrawnAmount = 0;
    let pendingWithdrawals = 0;
    (payouts || []).forEach((p: any) => {
      if (p.status === 'COMPLETED') withdrawnAmount += p.amount || 0;
      else if (p.status === 'PENDING') pendingWithdrawals += p.amount || 0;
    });

    const { data: userRecord } = await supabase
      .from('User')
      .select('walletBalance')
      .eq('id', organizerId)
      .single();

    const walletBalance = typeof userRecord?.walletBalance === 'number'
      ? userRecord.walletBalance
      : Math.max(0, revenue - withdrawnAmount - pendingWithdrawals);

    res.status(200).json({
      revenue,
      walletBalance,
      withdrawnAmount,
      pendingWithdrawals,
      ticketsSold,
      totalVotes,
      activeEvents: (events || []).length,
    });
  } catch (error: any) { res.status(500).json({ message: 'Error fetching stats', error: error.message }); }
};

export const getAttendees = async (req: AuthRequest, res: Response) => {
  try {
    const organizerId = req.user?.userId;
    if (!organizerId) return res.status(401).json({ message: 'Unauthorized' });
    
    // Fetch all completed order items for events owned by this organizer
    const { data: items, error } = await supabase
      .from('OrderItem')
      .select('id, isUsed, qrCode, order:Order!inner(*, user:User(name, email, phone)), ticket:Ticket!inner(*, event:Event!inner(title, organizerId))')
      .eq('ticket.event.organizerId', organizerId)
      .eq('order.status', 'COMPLETED')
      .order('id', { ascending: false });

    if (error) throw error;

    res.status(200).json((items || []).map((item: any) => ({
      id: item.id,
      name: item.order?.user?.name || 'Unknown',
      email: item.order?.user?.email || 'N/A',
      phone: item.order?.user?.phone || 'N/A',
      event: item.ticket?.event?.title || 'Unknown Event',
      ticket: item.ticket?.name || 'Ticket',
      amount: item.ticket?.price || 0,
      status: item.isUsed ? 'checked-in' : 'not-checked-in',
      date: item.order?.createdAt,
      qrCode: item.qrCode
    })));
  } catch (error: any) {
    console.error('Error fetching attendees', error);
    res.status(500).json({ message: 'Error fetching attendees', error: error.message });
  }
};

export const verifyTicket = async (req: AuthRequest, res: Response) => {
  try {
    const organizerId = req.user?.userId;
    if (!organizerId) return res.status(401).json({ message: 'Unauthorized' });
    
    const { id } = req.params; // OrderItem ID
    
    // In a real app we should check if the organizer owns the event this ticket belongs to
    const { error } = await supabase
      .from('OrderItem')
      .update({ isUsed: true })
      .eq('id', id);

    if (error) throw error;
    res.status(200).json({ message: 'Ticket verified successfully' });
  } catch (error: any) {
    res.status(500).json({ message: 'Error verifying ticket', error: error.message });
  }
};

export const getSales = async (req: AuthRequest, res: Response) => {
  try {
    const organizerId = req.user?.userId;
    if (!organizerId) return res.status(401).json({ message: 'Unauthorized' });
    const { data: recentItems, error } = await supabase
      .from('OrderItem')
      .select('id, order:Order(*, user:User(name)), ticket:Ticket!inner(*, event:Event!inner(title, organizerId))')
      .eq('ticket.event.organizerId', organizerId)
      .order('id', { ascending: false }).limit(10);
    if (error) throw error;
    res.status(200).json((recentItems || []).map((item: any) => ({
      id: item.id,
      user: { name: item.order?.user?.name || 'Unknown' },
      ticket: { type: item.ticket?.name || 'Ticket', price: item.ticket?.price || 0, event: { title: item.ticket?.event?.title || 'Unknown Event' } },
      status: item.order?.status === 'COMPLETED' ? 'Paid' : 'Pending',
      createdAt: item.order?.createdAt
    })));
  } catch (error: any) { res.status(500).json({ message: 'Error fetching sales', error: error.message }); }
};

export const getEvents = async (req: AuthRequest, res: Response) => {
  try {
    const organizerId = req.user?.userId;
    if (!organizerId) return res.status(401).json({ message: 'Unauthorized' });
    const { data: events, error } = await supabase
      .from('Event').select('*, Ticket(*)').eq('organizerId', organizerId).order('date', { ascending: true });
    if (error) throw error;
    res.status(200).json((events || []).map((event: any) => {
      const tickets: any[] = event.Ticket || [];
      let sold = 0, total = 0, revenue = 0;
      tickets.forEach((t: any) => { sold += t.sold || 0; total += t.quantity || 0; revenue += (t.sold || 0) * (t.price || 0); });
      const eventDate = event.date ? new Date(event.date) : null;
      let isPassed = false;
      if (eventDate && !isNaN(eventDate.getTime())) {
        const endOfDay = new Date(eventDate);
        endOfDay.setHours(23, 59, 59, 999);
        isPassed = endOfDay.getTime() < Date.now();
      }
      return {
        id: event.id,
        name: event.title,
        title: event.title,
        description: event.description,
        date: event.date,
        status: event.status || 'DRAFT',
        bannerImage: event.bannerImage,
        location: event.location,
        sold,
        total,
        revenue,
        isVotingEnabled: event.isVotingEnabled,
        isVotingPaid: event.isVotingPaid,
        voteCost: event.voteCost,
        isPassed,
        tickets: tickets.map((t: any) => ({
          id: t.id,
          name: t.name,
          price: t.price,
          quantity: t.quantity,
          sold: t.sold || 0,
        }))
      };
    }));
  } catch (error: any) { res.status(500).json({ message: 'Error fetching events', error: error.message }); }
};

export const getActivity = async (req: AuthRequest, res: Response) => {
  try {
    const organizerId = req.user?.userId;
    if (!organizerId) return res.status(401).json({ message: 'Unauthorized' });

    // All 3 queries fire in parallel
    const [eventsRes, purchasesRes, votesRes] = await Promise.all([
      supabase.from('Event').select('id, title, createdAt').eq('organizerId', organizerId).order('createdAt', { ascending: false }).limit(5),
      supabase.from('OrderItem')
        .select('id, quantity, ticket:Ticket!inner(name, event:Event!inner(title, organizerId)), order:Order!inner(createdAt, status, user:User(name))')
        .eq('ticket.event.organizerId', organizerId).eq('order.status', 'COMPLETED').order('id', { ascending: false }).limit(8),
      supabase.from('Vote')
        .select('id, createdAt, contestant:Contestant(name), category:VoteCategory!inner(name, event:Event!inner(organizerId))')
        .eq('category.event.organizerId', organizerId).order('createdAt', { ascending: false }).limit(8),
    ]);

    const activities: any[] = [];
    (eventsRes.data || []).forEach((e: any) => activities.push({ id: `event-${e.id}`, type: 'event', text: `Event "${e.title}" published`, createdAt: new Date(e.createdAt) }));
    (purchasesRes.data || []).forEach((item: any) => activities.push({ id: `purchase-${item.id}`, type: 'purchase', text: `${item.quantity} ${item.ticket?.name || 'ticket'}(s) purchased by ${item.order?.user?.name || 'Guest'} for "${item.ticket?.event?.title || 'Event'}"`, createdAt: new Date(item.order?.createdAt || 0) }));
    (votesRes.data || []).forEach((v: any) => activities.push({ id: `vote-${v.id}`, type: 'vote', text: `New vote for "${v.contestant?.name || 'Contestant'}" (${v.category?.name || 'Category'})`, createdAt: new Date(v.createdAt) }));

    res.status(200).json(
      activities.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 5)
        .map(act => ({ id: act.id, type: act.type, text: act.text, time: getRelativeTime(act.createdAt), icon: iconMap[act.type] || '', color: colorMap[act.type] || '' }))
    );
  } catch (error: any) { res.status(500).json({ message: 'Error fetching activity', error: error.message }); }
};

export const addContestant = async (req: AuthRequest, res: Response) => {
  try {
    const organizerId = req.user?.userId;
    if (!organizerId) return res.status(401).json({ message: 'Unauthorized' });

    const { eventId, name, nickname, faculty, department, level, bio, instagram, category, image } = req.body;

    if (!eventId || !name || !category) {
      return res.status(400).json({ message: 'Event ID, name, and category are required' });
    }

    // Verify organizer owns this event
    const { data: event, error: eventErr } = await supabase
      .from('Event')
      .select('id')
      .eq('id', eventId)
      .eq('organizerId', organizerId)
      .single();

    if (eventErr || !event) {
      return res.status(403).json({ message: 'Forbidden: You do not own this event' });
    }

    // Handle Category: Find existing or create new
    let categoryId: string;
    const { data: existingCategory } = await supabase
      .from('VoteCategory')
      .select('id')
      .eq('eventId', eventId)
      .ilike('name', category)
      .single();

    if (existingCategory) {
      categoryId = existingCategory.id;
    } else {
      const newCatId = crypto.randomUUID();
      const { error: catErr } = await supabase
        .from('VoteCategory')
        .insert({ id: newCatId, name: category, eventId });
      
      if (catErr) throw new Error(`Failed to create category: ${catErr.message}`);
      categoryId = newCatId;
    }

    // Process image base64 if provided
    let finalImage = '/images/party.png'; // fallback
      if (image && image.startsWith('data:image/')) {
        // Store base64 string directly in db to bypass Vercel EROFS read-only crashes
        finalImage = image;
      } else if (image && !image.startsWith('blob:')) {
        finalImage = image;
      }

    // Build details JSON string
    const detailsObj = {
      nickname: nickname || undefined,
      faculty: faculty || undefined,
      department: department || undefined,
      level: level || undefined,
      bio: bio || undefined,
      instagram: instagram || undefined
    };
    
    // Remove undefined properties
    Object.keys(detailsObj).forEach(key => (detailsObj as any)[key] === undefined && delete (detailsObj as any)[key]);

    const contestantId = crypto.randomUUID();
    const { data: contestant, error: insertErr } = await supabase
      .from('Contestant')
      .insert({
        id: contestantId,
        name,
        image: finalImage,
        details: Object.keys(detailsObj).length > 0 ? JSON.stringify(detailsObj) : null,
        categoryId
      })
      .select()
      .single();

    if (insertErr) throw new Error(`Failed to insert contestant: ${insertErr.message}`);

    res.status(201).json({ message: 'Contestant added successfully', contestant });
  } catch (error: any) {
    console.error('Error adding contestant:', error);
    res.status(500).json({ message: 'Error adding contestant', error: error.message });
  }
};

export const addCategory = async (req: AuthRequest, res: Response) => {
  try {
    const organizerId = req.user?.userId;
    if (!organizerId) return res.status(401).json({ message: 'Unauthorized' });

    const { eventId, name } = req.body;

    if (!eventId || !name) {
      return res.status(400).json({ message: 'Event ID and category name are required' });
    }

    // Verify organizer owns this event
    const { data: event, error: eventErr } = await supabase
      .from('Event')
      .select('id')
      .eq('id', eventId)
      .eq('organizerId', organizerId)
      .single();

    if (eventErr || !event) {
      return res.status(403).json({ message: 'Forbidden: You do not own this event' });
    }

    // Check if category already exists
    const { data: existingCategory } = await supabase
      .from('VoteCategory')
      .select('id')
      .eq('eventId', eventId)
      .ilike('name', name)
      .single();

    if (existingCategory) {
      return res.status(400).json({ message: 'Category already exists' });
    }

    const categoryId = crypto.randomUUID();
    const { error: catErr } = await supabase
      .from('VoteCategory')
      .insert({ id: categoryId, name, eventId });

    if (catErr) throw new Error(`Failed to create category: ${catErr.message}`);

    res.status(201).json({ message: 'Category created successfully', category: { id: categoryId, name, eventId } });
  } catch (error: any) {
    console.error('Error adding category:', error);
    res.status(500).json({ message: 'Error adding category', error: error.message });
  }
};


export const updateVotingSettings = async (req: AuthRequest, res: Response) => {
  try {
    const organizerId = req.user?.userId;
    if (!organizerId) return res.status(401).json({ message: 'Unauthorized' });

    const { eventId } = req.params;
    const { isVotingEnabled, isVotingPaid, voteCost } = req.body;

    if (!eventId) {
      return res.status(400).json({ message: 'Event ID is required' });
    }

    // Verify organizer owns this event
    const { data: event, error: eventErr } = await supabase
      .from('Event')
      .select('id')
      .eq('id', eventId)
      .eq('organizerId', organizerId)
      .single();

    if (eventErr || !event) {
      return res.status(403).json({ message: 'Forbidden: You do not own this event' });
    }

    // Prepare update payload
    const updateData: any = {};
    if (isVotingEnabled !== undefined) updateData.isVotingEnabled = isVotingEnabled;
    if (isVotingPaid !== undefined) updateData.isVotingPaid = isVotingPaid;
    if (voteCost !== undefined) updateData.voteCost = parseFloat(voteCost);

    const { data: updatedEvent, error: updateErr } = await supabase
      .from('Event')
      .update(updateData)
      .eq('id', eventId)
      .select('id, isVotingEnabled, isVotingPaid, voteCost')
      .single();

    if (updateErr) throw new Error(`Failed to update voting settings: ${updateErr.message}`);

    res.status(200).json({ message: 'Voting settings updated', event: updatedEvent });
  } catch (error: any) {
    console.error('Error updating voting settings:', error);
    res.status(500).json({ message: 'Error updating voting settings', error: error.message });
  }
};

export const getTeamMembers = async (req: AuthRequest, res: Response) => {
  try {
    res.status(200).json([]);
  } catch (error: any) {
    console.error('Error fetching team members:', error);
    res.status(500).json({ message: 'Error fetching team members', error: error.message });
  }
};

export const getWallet = async (req: AuthRequest, res: Response) => {
  try {
    const organizerId = req.user?.userId;
    if (!organizerId) return res.status(401).json({ message: 'Unauthorized' });

    // 1. Fetch User Payout & Profile Details
    const { data: user } = await supabase
      .from('User')
      .select('name, email, phone, bankName, accountNumber, bankCode')
      .eq('id', organizerId)
      .single();

    // 2. Fetch Events for this organizer
    const { data: events } = await supabase
      .from('Event')
      .select('id, title')
      .eq('organizerId', organizerId);

    const eventIds = (events || []).map((e: any) => e.id);

    // 3. Fetch Tickets
    let totalRevenue = 0;
    const transactions: any[] = [];

    if (eventIds.length > 0) {
      const { data: tickets } = await supabase
        .from('Ticket')
        .select('id, name, price, eventId')
        .in('eventId', eventIds);

      const ticketIds = (tickets || []).map((t: any) => t.id);

      if (ticketIds.length > 0) {
        // Fetch ONLY successful/completed order items
        const { data: completedItems, error: itemsErr } = await supabase
          .from('OrderItem')
          .select('id, quantity, ticket:Ticket(name, price, event:Event(title)), order:Order!inner(id, createdAt, status, user:User(name, email))')
          .in('ticketId', ticketIds)
          .eq('order.status', 'COMPLETED')
          .order('id', { ascending: false });

        if (itemsErr) {
          console.error('Error fetching completed items for wallet:', itemsErr);
        } else if (completedItems) {
          for (const item of completedItems as any[]) {
            const itemAmount = (item.ticket?.price || 0) * (item.quantity || 1);
            totalRevenue += itemAmount;
            transactions.push({
              id: item.id,
              orderId: item.order?.id,
              event: item.ticket?.event?.title || 'Event',
              ticketType: item.ticket?.name || 'Ticket',
              quantity: item.quantity || 1,
              amount: itemAmount,
              customer: item.order?.user?.name || item.order?.user?.email || 'Guest Attendee',
              date: item.order?.createdAt,
              status: 'Completed',
            });
          }
        }
      }
    }

    // 4. Fetch Payouts / Withdrawals
    const { data: payouts, error: payoutsErr } = await supabase
      .from('Payout')
      .select('*')
      .eq('userId', organizerId)
      .order('createdAt', { ascending: false });

    if (payoutsErr) {
      console.error('Error fetching payouts for wallet:', payoutsErr);
    }

    let withdrawnAmount = 0;
    let pendingWithdrawals = 0;

    (payouts || []).forEach((p: any) => {
      if (p.status === 'COMPLETED') {
        withdrawnAmount += p.amount || 0;
      } else if (p.status === 'PENDING') {
        pendingWithdrawals += p.amount || 0;
      }
    });

    const availableBalance = Math.max(0, totalRevenue - withdrawnAmount - pendingWithdrawals);

    // Keep User.walletBalance in sync with availableBalance in database
    await supabase.from('User').update({ walletBalance: availableBalance }).eq('id', organizerId);

    // Add withdrawals as debit ledger transactions
    (payouts || []).forEach((p: any) => {
      transactions.push({
        id: p.id,
        orderId: p.reference || `WD-${p.id.slice(0, 8)}`,
        event: 'Settlement Withdrawal',
        ticketType: `${p.bankName || 'Bank'} (${p.accountNumber || '—'})`,
        quantity: 1,
        amount: -Math.abs(p.amount || 0),
        customer: p.accountName || user?.name || 'Withdrawal Transfer',
        date: p.updatedAt || p.createdAt,
        status: p.status === 'COMPLETED' ? 'Completed' : p.status === 'PENDING' ? 'Pending' : 'Rejected',
        type: 'debit',
      });
    });

    // Sort transactions with newest first
    transactions.sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());

    res.status(200).json({
      totalRevenue,
      availableBalance,
      pendingWithdrawals,
      withdrawnAmount,
      bankDetails: {
        bankName: user?.bankName || '',
        accountNumber: user?.accountNumber || '',
        accountName: user?.name || '',
      },
      transactions,
      payouts: payouts || [],
    });
  } catch (error: any) {
    console.error('getWallet error:', error);
    res.status(500).json({ message: 'Error loading wallet', error: error.message });
  }
};

export const requestWithdrawal = async (req: AuthRequest, res: Response) => {
  try {
    const organizerId = req.user?.userId;
    if (!organizerId) return res.status(401).json({ message: 'Unauthorized' });

    const { amount, bankName, accountNumber, accountName } = req.body;
    const withdrawAmount = parseFloat(amount);

    if (!withdrawAmount || isNaN(withdrawAmount) || withdrawAmount <= 0) {
      return res.status(400).json({ message: 'Please enter a valid withdrawal amount.' });
    }

    if (withdrawAmount < 500) {
      return res.status(400).json({ message: 'Minimum withdrawal amount is ₦500.' });
    }

    // 1. Fetch User details
    const { data: user } = await supabase
      .from('User')
      .select('name, email, phone, bankName, accountNumber')
      .eq('id', organizerId)
      .single();

    const finalBank = bankName || user?.bankName;
    const finalAccount = accountNumber || user?.accountNumber;
    const finalName = accountName || user?.name;

    if (!finalBank || !finalAccount) {
      return res.status(400).json({ message: 'Bank name and account number are required for withdrawal.' });
    }

    // 2. Calculate current available balance strictly from successful ticket payments
    const { data: events } = await supabase
      .from('Event')
      .select('id')
      .eq('organizerId', organizerId);

    const eventIds = (events || []).map((e: any) => e.id);
    let totalRevenue = 0;

    if (eventIds.length > 0) {
      const { data: tickets } = await supabase
        .from('Ticket')
        .select('id, price')
        .in('eventId', eventIds);

      const ticketIds = (tickets || []).map((t: any) => t.id);
      if (ticketIds.length > 0) {
        const { data: completedItems } = await supabase
          .from('OrderItem')
          .select('quantity, ticket:Ticket(price), order:Order!inner(status)')
          .in('ticketId', ticketIds)
          .eq('order.status', 'COMPLETED');

        (completedItems || []).forEach((item: any) => {
          totalRevenue += (item.ticket?.price || 0) * (item.quantity || 1);
        });
      }
    }

    // 3. Fetch past payouts to check balance
    const { data: payouts } = await supabase
      .from('Payout')
      .select('amount, status')
      .eq('userId', organizerId);

    let alreadyWithdrawn = 0;
    (payouts || []).forEach((p: any) => {
      if (p.status === 'COMPLETED' || p.status === 'PENDING') {
        alreadyWithdrawn += p.amount || 0;
      }
    });

    const availableBalance = totalRevenue - alreadyWithdrawn;

    if (withdrawAmount > availableBalance) {
      return res.status(400).json({
        message: `Insufficient funds. Your available balance is ₦${Math.max(0, availableBalance).toLocaleString()}.`,
      });
    }

    // 4. Create Payout Request in PENDING status
    const payoutId = crypto.randomUUID();
    const { data: newPayout, error: payoutErr } = await supabase
      .from('Payout')
      .insert({
        id: payoutId,
        userId: organizerId,
        amount: withdrawAmount,
        bankName: finalBank,
        accountNumber: finalAccount,
        accountName: finalName,
        status: 'PENDING',
        reference: `WD-${Date.now()}`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .select()
      .single();

    if (payoutErr) {
      console.error('Error creating withdrawal request:', payoutErr);
      throw payoutErr;
    }

    // Also update user's saved bank if not set
    if (!user?.bankName || !user?.accountNumber) {
      await supabase
        .from('User')
        .update({ bankName: finalBank, accountNumber: finalAccount })
        .eq('id', organizerId);
    }

    res.status(201).json({
      message: 'Withdrawal request submitted successfully! Funds will be reviewed and released by an administrator.',
      payout: newPayout,
    });
  } catch (error: any) {
    console.error('requestWithdrawal error:', error);
    res.status(500).json({ message: 'Error submitting withdrawal', error: error.message });
  }
};

/**
 * SEND FREE / COMPLIMENTARY TICKET TO ATTENDEE EMAIL
 * - Validates that the event has not passed
 * - Validates ticket category
 * - Generates admission pass with QR code and PDF
 * - Emails pass directly to recipient via Resend
 */
export const sendFreeTicket = async (req: AuthRequest, res: Response) => {
  try {
    const organizerId = req.user?.userId;
    if (!organizerId) return res.status(401).json({ message: 'Unauthorized' });

    const { email, name, eventId, ticketId, phone } = req.body;

    if (!email || !email.trim()) {
      return res.status(400).json({ message: 'Recipient email is required' });
    }
    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'Attendee name is required' });
    }
    if (!eventId) {
      return res.status(400).json({ message: 'Please select an event' });
    }
    if (!ticketId) {
      return res.status(400).json({ message: 'Please select a ticket category' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanName = name.trim();

    // 1. Fetch Event and Tickets
    const { data: event, error: eventErr } = await supabase
      .from('Event')
      .select('*, Ticket(*)')
      .eq('id', eventId)
      .single();

    if (eventErr || !event) {
      return res.status(404).json({ message: 'Event not found' });
    }

    // 2. Security: Ensure organizer owns event (or is ADMIN)
    if (event.organizerId !== organizerId && req.user?.role !== 'ADMIN') {
      return res.status(403).json({ message: 'You do not have permission to issue tickets for this event' });
    }

    // 3. CRITICAL: Validate that the event has NOT passed
    if (event.date) {
      const eventDate = new Date(event.date);
      if (!isNaN(eventDate.getTime())) {
        const eventDay = new Date(eventDate);
        eventDay.setHours(23, 59, 59, 999);
        if (eventDay.getTime() < Date.now()) {
          return res.status(400).json({
            message: `Cannot send ticket for "${event.title}" because this event has already passed (${eventDate.toLocaleDateString()}). Please select an active upcoming event.`
          });
        }
      }
    }

    // 4. Validate Ticket Category
    const ticket = (event.Ticket || []).find((t: any) => t.id === ticketId);
    if (!ticket) {
      return res.status(400).json({ message: 'Selected ticket category does not exist for this event' });
    }

    // 5. Find or create recipient user
    let recipientUserId: string;
    const { data: existingUser } = await supabase
      .from('User')
      .select('*')
      .eq('email', cleanEmail)
      .single();

    if (existingUser) {
      recipientUserId = existingUser.id;
    } else {
      recipientUserId = crypto.randomUUID();
      const randomPassword = await bcrypt.hash(recipientUserId, 10);
      const { data: createdUser, error: userErr } = await supabase
        .from('User')
        .insert({
          id: recipientUserId,
          email: cleanEmail,
          name: cleanName,
          phone: phone?.trim() || null,
          password: randomPassword,
          role: 'STUDENT',
          isVerified: true,
          updatedAt: new Date()
        })
        .select()
        .single();

      if (userErr) {
        console.warn('⚠️ User creation warning:', userErr.message);
      }
      recipientUserId = createdUser?.id || recipientUserId;
    }

    // 6. Generate unique ticket token & IDs
    const qrCode = `OTX-${crypto.randomUUID()}`;
    const orderId = crypto.randomUUID();
    const reference = `FREE-${Date.now().toString(36).toUpperCase()}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`;

    // 7. Create Completed Order (Free / ₦0)
    const { data: order, error: orderErr } = await supabase
      .from('Order')
      .insert({
        id: orderId,
        userId: recipientUserId,
        totalPrice: 0,
        status: 'COMPLETED',
        updatedAt: new Date()
      })
      .select()
      .single();

    if (orderErr) {
      return res.status(500).json({ message: 'Failed to create order record', error: orderErr.message });
    }

    // 8. Create OrderItem
    const { error: itemErr } = await supabase
      .from('OrderItem')
      .insert({
        id: crypto.randomUUID(),
        orderId: order.id,
        ticketId: ticket.id,
        quantity: 1,
        qrCode,
        isUsed: false
      });

    if (itemErr) {
      return res.status(500).json({ message: 'Failed to create ticket item', error: itemErr.message });
    }

    // 9. Create Payment record for tracking
    await supabase
      .from('Payment')
      .insert({
        id: crypto.randomUUID(),
        orderId: order.id,
        reference,
        amount: 0,
        status: 'COMPLETED',
        updatedAt: new Date()
      });

    // 10. Increment ticket sold count
    await supabase
      .from('Ticket')
      .update({ sold: (ticket.sold || 0) + 1 })
      .eq('id', ticket.id);

    // 11. Dispatch Emails asynchronously via Resend
    void (async () => {
      try {
        const formattedDate = event.date
          ? new Date(event.date).toLocaleDateString('en-US', {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
              year: 'numeric'
            })
          : 'Event Date TBA';

        // Order Receipt Email
        await sendOrderReceiptEmail({
          email: cleanEmail,
          name: cleanName,
          eventName: event.title,
          reference,
          amount: 0,
          orderId: order.id,
          phone: phone?.trim() || undefined,
          items: [{ name: `${ticket.name} (Complimentary Pass)`, ticketName: ticket.name, quantity: 1, price: 0 }]
        });

        await new Promise((r) => setTimeout(r, 1500));

        // Official QR Ticket Pass with PDF attachment
        await sendTicketPassEmail({
          email: cleanEmail,
          name: cleanName,
          eventName: event.title,
          ticketType: `${ticket.name} (Complimentary Pass)`,
          venue: event.location || 'Venue TBA',
          date: formattedDate,
          verificationId: qrCode,
          reference,
          phone: phone?.trim() || undefined,
        });

        console.log(`🎟️ Free ticket (${ticket.name}) successfully issued and emailed to ${cleanEmail}`);
      } catch (emailErr: any) {
        console.error('❌ Failed to email free ticket:', emailErr.message);
      }
    })();

    return res.status(200).json({
      message: `Free ${ticket.name} ticket sent successfully to ${cleanEmail}!`,
      ticket: {
        qrCode,
        reference,
        attendeeName: cleanName,
        attendeeEmail: cleanEmail,
        ticketType: ticket.name,
        eventName: event.title,
        date: event.date
      }
    });
  } catch (error: any) {
    console.error('Error sending free ticket:', error);
    res.status(500).json({ message: 'Error issuing free ticket', error: error.message });
  }
};


