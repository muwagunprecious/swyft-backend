import { Request, Response } from 'express';
import crypto from 'crypto';
import { supabase } from '../config/supabase';
import { AuthRequest } from '../middleware/auth.middleware';

export const getAllEvents = async (req: Request, res: Response) => {
  try {
    const { category } = req.query;
    let query = supabase
      .from('Event')
      .select('*, Ticket(*), organizer:User(name)')
      .order('date', { ascending: true });

    if (category) {
      query = query.eq('category', category as string);
    }

    let { data: events, error } = await query;
    if (error) throw error;

    if (events) {
      events = events.filter((e: any) => !e.isSuspended);
    }

    res.status(200).json(events);
  } catch (error: any) {
    console.error('Error:', error);
    res.status(500).json({ message: 'Error fetching events', error: error.message });
  }
};

export const getEventById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    console.log('getEventById called with id:', id);
    const { data: event, error } = await supabase
      .from('Event')
      .select('*, Ticket(*), organizer:User(name), VoteCategory(*, Contestant(*))')
      .eq('id', id)
      .single();

    if (error) {
      console.error('getEventById Supabase error:', error);
    }

    if (error || !event) {
      return res.status(404).json({ message: 'Event not found' });
    }

    res.status(200).json(event);
  } catch (error: any) {
    console.error('Error in getEventById:', error);
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};

export const createEvent = async (req: AuthRequest, res: Response) => {
  try {
    console.log('Create Event Request Body (no image):', JSON.stringify({ ...req.body, bannerImage: req.body.bannerImage ? '[IMAGE_DATA]' : null }, null, 2));
    const { title, description, bannerImage, date, location, category, tickets } = req.body;
    const organizerId = req.user?.userId;

    if (!organizerId) return res.status(401).json({ message: 'Unauthorized' });
    if (!title?.trim()) return res.status(400).json({ message: 'Title is required' });
    if (!date) return res.status(400).json({ message: 'Date is required' });

    const eventDate = new Date(date);
    if (isNaN(eventDate.getTime())) {
      return res.status(400).json({ message: 'Invalid date format' });
    }

    // Upload image locally if base64 provided
    let finalBannerImage = '/images/party.png';
      if (bannerImage && bannerImage.startsWith('data:image/')) {
        // Safe and cloud-native: Store the base64 string directly in the database.
        // This avoids Vercel EROFS read-only crashes, requires no external buckets, and solves CORS locally.
        finalBannerImage = bannerImage;
      } else if (bannerImage && !bannerImage.startsWith('blob:')) {
        // Accept plain URLs (e.g. https://...)
        finalBannerImage = bannerImage;
      }

    // 1. Create Event (no updatedAt — Supabase handles it automatically)
    const eventId = crypto.randomUUID();
    const { data: event, error: eventError } = await supabase
      .from('Event')
      .insert({
        id: eventId,
        title,
        description,
        bannerImage: finalBannerImage,
        date: eventDate.toISOString(),
        location,
        category,
        organizerId,
      })
      .select()
      .single();

    if (eventError) {
      console.error('Event insert error:', eventError);
      throw eventError;
    }

    // 2. Create Tickets if any
    if (tickets && tickets.length > 0) {
      const ticketsWithIds = tickets.map((t: any) => ({
        id: crypto.randomUUID(),
        name: t.name,
        price: parseFloat(t.price),
        quantity: parseInt(t.quantity),
        sold: 0,
        eventId: event.id,
      }));
      const { error: ticketsError } = await supabase
        .from('Ticket')
        .insert(ticketsWithIds);

      if (ticketsError) {
        console.error('Ticket insert error:', ticketsError);
        throw ticketsError;
      }
    }

    // Fetch final event with tickets
    const { data: finalEvent } = await supabase
      .from('Event')
      .select('*, Ticket(*)')
      .eq('id', event.id)
      .single();

    res.status(201).json(finalEvent);
  } catch (error: any) {
    console.error('createEvent error:', error);
    res.status(500).json({ message: 'Error creating event', details: error.message, code: error.code });
  }
};
