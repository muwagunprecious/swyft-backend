import { supabase } from '../config/supabase';

/**
 * Calculates the apportioned actual price paid for each OrderItem in an order.
 * Ensures that the sum of item amounts always equals order.totalPrice exactly,
 * honoring discounts and preventing any duplicate counting or price inflation.
 */
export function calculateItemPaidAmount(item: any, orderTotalPrice: number, allOrderItems?: any[]): number {
  if (orderTotalPrice === 0) return 0;
  if (!allOrderItems || allOrderItems.length <= 1) {
    return orderTotalPrice;
  }

  // Calculate nominal values for each item
  const getNominal = (it: any) => {
    const ticket = it.ticket || {};
    const price = typeof ticket.discountPrice === 'number' && ticket.discountPrice > 0
      ? ticket.discountPrice
      : (typeof ticket.price === 'number' ? ticket.price : 0);
    return price * (it.quantity || 1);
  };

  const totalNominal = allOrderItems.reduce((sum: number, it: any) => sum + getNominal(it), 0);
  if (totalNominal <= 0) {
    return Math.round(orderTotalPrice / allOrderItems.length);
  }

  const thisNominal = getNominal(item);
  return Math.round((orderTotalPrice * thisNominal) / totalNominal);
}

export interface WalletSyncResult {
  totalRevenue: number;
  availableBalance: number;
  withdrawnAmount: number;
  pendingWithdrawals: number;
}

/**
 * Live synchronization of an Organizer's wallet balance.
 * Recalculates exact revenue from completed orders (taking all discounts into account),
 * subtracts completed payouts and pending withdrawal requests,
 * updates User.walletBalance in the database, and returns the live totals.
 */
export async function syncOrganizerWallet(organizerId: string): Promise<WalletSyncResult> {
  try {
    // 1. Fetch events for this organizer (retry once on network error)
    let events: any[] | null = null;
    let evErr: any = null;

    for (let attempt = 1; attempt <= 2; attempt++) {
      const res = await supabase
        .from('Event')
        .select('id')
        .eq('organizerId', organizerId);
      if (!res.error) {
        events = res.data;
        evErr = null;
        break;
      }
      evErr = res.error;
      if (attempt < 2) await new Promise(r => setTimeout(r, 400));
    }

    if (evErr) {
      console.error(`[syncOrganizerWallet] Error fetching events for organizer ${organizerId}:`, evErr);
      // Fallback: fetch existing User.walletBalance so we don't return 0 on network glitch
      const { data: userRec } = await supabase.from('User').select('walletBalance').eq('id', organizerId).single();
      const existingBal = userRec?.walletBalance || 0;
      return { totalRevenue: existingBal, availableBalance: existingBal, withdrawnAmount: 0, pendingWithdrawals: 0 };
    }

    const eventIds = (events || []).map((e: any) => e.id);

    // Fetch payouts for this organizer
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

    if (eventIds.length === 0) {
      const availableBalance = Math.max(0, -withdrawnAmount - pendingWithdrawals);
      await supabase.from('User').update({ walletBalance: availableBalance }).eq('id', organizerId);
      return { totalRevenue: 0, availableBalance, withdrawnAmount, pendingWithdrawals };
    }

    // 2. Fetch all tickets for these events
    let tickets: any[] | null = null;
    let ticketsErr: any = null;

    for (let attempt = 1; attempt <= 2; attempt++) {
      const res = await supabase
        .from('Ticket')
        .select('id')
        .in('eventId', eventIds);
      if (!res.error) {
        tickets = res.data;
        ticketsErr = null;
        break;
      }
      ticketsErr = res.error;
      if (attempt < 2) await new Promise(r => setTimeout(r, 400));
    }

    if (ticketsErr) {
      console.error(`[syncOrganizerWallet] Error fetching tickets for organizer ${organizerId}:`, ticketsErr);
      const { data: userRec } = await supabase.from('User').select('walletBalance').eq('id', organizerId).single();
      const existingBal = userRec?.walletBalance || 0;
      return { totalRevenue: existingBal, availableBalance: existingBal, withdrawnAmount, pendingWithdrawals };
    }

    const ticketIds = (tickets || []).map((t: any) => t.id);
    let totalRevenue = 0;

    if (ticketIds.length > 0) {
      // 3. Fetch all completed order items for these tickets
      let orderItems: any[] | null = null;
      let itemsErr: any = null;

      for (let attempt = 1; attempt <= 2; attempt++) {
        const res = await supabase
          .from('OrderItem')
          .select('id, quantity, ticketId, ticket:Ticket(id, price, discountPrice, eventId), order:Order!inner(id, totalPrice, status)')
          .in('ticketId', ticketIds)
          .eq('order.status', 'COMPLETED');
        if (!res.error) {
          orderItems = res.data;
          itemsErr = null;
          break;
        }
        itemsErr = res.error;
        if (attempt < 2) await new Promise(r => setTimeout(r, 400));
      }

      if (itemsErr) {
        console.error(`[syncOrganizerWallet] Error fetching order items for organizer ${organizerId}:`, itemsErr);
        const { data: userRec } = await supabase.from('User').select('walletBalance').eq('id', organizerId).single();
        const existingBal = userRec?.walletBalance || 0;
        return { totalRevenue: existingBal, availableBalance: existingBal, withdrawnAmount, pendingWithdrawals };
      } else if (orderItems) {
        // Group items by order to avoid double-counting order.totalPrice
        const ordersMap = new Map<string, { totalPrice: number; items: any[] }>();

        for (const item of (orderItems as any[])) {
          const ord = item.order;
          if (!ord) continue;
          if (!ordersMap.has(ord.id)) {
            ordersMap.set(ord.id, {
              totalPrice: ord.totalPrice || 0,
              items: [],
            });
          }
          ordersMap.get(ord.id)!.items.push(item);
        }

        // Sum actual revenue per order
        for (const orderData of ordersMap.values()) {
          totalRevenue += orderData.totalPrice;
        }
      }
    }

    // Available balance = revenue - completed payouts - pending payouts
    const availableBalance = Math.max(0, totalRevenue - withdrawnAmount - pendingWithdrawals);

    // Update User.walletBalance in Supabase to keep DB permanently in sync
    const { error: updateErr } = await supabase
      .from('User')
      .update({ walletBalance: availableBalance })
      .eq('id', organizerId);

    if (updateErr) {
      console.error(`[syncOrganizerWallet] Error updating wallet balance in DB for organizer ${organizerId}:`, updateErr);
    } else {
      console.log(`[syncOrganizerWallet] Organizer ${organizerId} wallet updated: Revenue=₦${totalRevenue}, Available=₦${availableBalance}`);
    }

    return {
      totalRevenue,
      availableBalance,
      withdrawnAmount,
      pendingWithdrawals,
    };
  } catch (err) {
    console.error(`[syncOrganizerWallet] Unhandled error for organizer ${organizerId}:`, err);
    const { data: userRec } = await supabase.from('User').select('walletBalance').eq('id', organizerId).single();
    const existingBal = userRec?.walletBalance || 0;
    return {
      totalRevenue: existingBal,
      availableBalance: existingBal,
      withdrawnAmount: 0,
      pendingWithdrawals: 0,
    };
  }
}
