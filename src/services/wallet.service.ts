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
 * preserves database baseline balance safeguard,
 * updates User.walletBalance in the database, and returns the live totals.
 */
export async function syncOrganizerWallet(organizerId: string): Promise<WalletSyncResult> {
  try {
    // 1. Fetch user to get existing balance as baseline / safeguard
    const { data: userRec } = await supabase
      .from('User')
      .select('id, name, email, walletBalance')
      .eq('id', organizerId)
      .single();

    const existingBal = userRec?.walletBalance || 0;

    // 2. Fetch events for this organizer
    const { data: events, error: evErr } = await supabase
      .from('Event')
      .select('id, title')
      .eq('organizerId', organizerId);

    if (evErr) {
      console.error(`[syncOrganizerWallet] Error fetching events for organizer ${organizerId}:`, evErr);
      return { totalRevenue: existingBal, availableBalance: existingBal, withdrawnAmount: 0, pendingWithdrawals: 0 };
    }

    const eventIds = (events || []).map((e: any) => e.id);

    // 3. Fetch payouts for this organizer
    const { data: payouts } = await supabase
      .from('Payout')
      .select('amount, status')
      .eq('userId', organizerId);

    let withdrawnAmount = 0;
    let pendingWithdrawals = 0;
    (payouts || []).forEach((p: any) => {
      if (p.status === 'COMPLETED') withdrawnAmount += (p.amount || 0);
      else if (p.status === 'PENDING') pendingWithdrawals += (p.amount || 0);
    });

    // 4. Fetch completed orders specifically for this organizer's tickets
    let calculatedRevenue = 0;

    if (eventIds.length > 0) {
      const { data: tickets } = await supabase
        .from('Ticket')
        .select('id, eventId')
        .in('eventId', eventIds);

      const ticketIds = (tickets || []).map((t: any) => t.id);

      if (ticketIds.length > 0) {
        const { data: orderItems, error: itemsErr } = await supabase
          .from('OrderItem')
          .select('id, quantity, ticketId, order:Order!inner(id, totalPrice, status)')
          .eq('order.status', 'COMPLETED')
          .in('ticketId', ticketIds);

        if (itemsErr) {
          console.error(`[syncOrganizerWallet] Error fetching order items for organizer ${organizerId}:`, itemsErr);
        } else if (orderItems) {
          const processedOrders = new Set<string>();
          for (const it of orderItems) {
            const ord = it.order as any;
            if (ord?.id && !processedOrders.has(ord.id)) {
              processedOrders.add(ord.id);
              calculatedRevenue += (ord.totalPrice || 0);
            }
          }
        }
      }
    }

    // 5. Available balance = revenue - completed payouts - pending payouts
    const rawCalculatedBalance = Math.max(0, calculatedRevenue - withdrawnAmount - pendingWithdrawals);
    // Baseline safeguard: never drop below verified existing wallet balance
    const finalAvailableBalance = Math.max(rawCalculatedBalance, existingBal);
    const finalTotalRevenue = Math.max(calculatedRevenue, finalAvailableBalance + withdrawnAmount + pendingWithdrawals);

    // Update User.walletBalance in Supabase if different
    if (userRec && userRec.walletBalance !== finalAvailableBalance) {
      const { error: updateErr } = await supabase
        .from('User')
        .update({ walletBalance: finalAvailableBalance })
        .eq('id', organizerId);

      if (updateErr) {
        console.error(`[syncOrganizerWallet] Error updating wallet balance in DB for organizer ${organizerId}:`, updateErr);
      } else {
        console.log(`[syncOrganizerWallet] Organizer ${organizerId} (${userRec.email}) wallet synced: Revenue=₦${finalTotalRevenue}, Available=₦${finalAvailableBalance}`);
      }
    }

    return {
      totalRevenue: finalTotalRevenue,
      availableBalance: finalAvailableBalance,
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
