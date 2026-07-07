import { Response } from 'express';
import { supabase } from '../config/supabase';
import { AuthRequest } from '../middleware/auth.middleware';

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
      return res.status(200).json({ 
        stats: { revenue: 0, ticketsSold: 0, totalVotes: 0, activeEvents: 0 }, 
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
      stats: { revenue, ticketsSold, totalVotes, activeEvents: events.length },
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
    res.status(200).json({ revenue, ticketsSold, totalVotes, activeEvents: (events || []).length });
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
      return { id: event.id, name: event.title, title: event.title, description: event.description, date: event.date, status: event.status || 'DRAFT', bannerImage: event.bannerImage, location: event.location, sold, total, revenue, isVotingEnabled: event.isVotingEnabled, isVotingPaid: event.isVotingPaid, voteCost: event.voteCost };
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

import crypto from 'crypto';

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
