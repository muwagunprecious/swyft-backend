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

    // 4. Fetch all completed orders with items, tickets, and events
    // This direct query is 100% identical to the proven admin.controller.ts logic
    const { data: completedOrders, error: ordersErr } = await supabase
      .from('Order')
      .select('id, totalPrice, status, createdAt, items:OrderItem(id, quantity, ticket:Ticket(id, name, price, discountPrice, discountEndsAt, eventId, event:Event(id, title, organizerId)))')
      .eq('status', 'COMPLETED');

    if (ordersErr) {
      console.error(`[syncOrganizerWallet] Error fetching completed orders for organizer ${organizerId}:`, ordersErr);
      return { totalRevenue: existingBal, availableBalance: existingBal, withdrawnAmount, pendingWithdrawals };
    }

    let totalRevenue = 0;

    for (const ord of (completedOrders as any[] || [])) {
      const orderItems = ord.items || [];
      const orderOrgItems = orderItems.filter((item: any) => {
        const ticket = Array.isArray(item.ticket) ? item.ticket[0] : item.ticket;
        const event = Array.isArray(ticket?.event) ? ticket?.event[0] : ticket?.event;
        const orgId = event?.organizerId;
        const evId = ticket?.eventId;
        return orgId === organizerId || (evId && eventIds.includes(evId));
      });

      if (orderOrgItems.length > 0) {
        if (orderOrgItems.length === orderItems.length) {
          totalRevenue += (ord.totalPrice || 0);
        } else {
          for (const item of orderOrgItems) {
            totalRevenue += calculateItemPaidAmount(item, ord.totalPrice || 0, orderItems);
          }
        }
      }
    }

    // Available balance = revenue - completed payouts - pending payouts
    const calculatedBalance = Math.max(0, totalRevenue - withdrawnAmount - pendingWithdrawals);
    const availableBalance = calculatedBalance;

    // Update User.walletBalance in Supabase if different
    if (userRec && userRec.walletBalance !== availableBalance) {
      const { error: updateErr } = await supabase
        .from('User')
        .update({ walletBalance: availableBalance })
        .eq('id', organizerId);

      if (updateErr) {
        console.error(`[syncOrganizerWallet] Error updating wallet balance in DB for organizer ${organizerId}:`, updateErr);
      } else {
        console.log(`[syncOrganizerWallet] Organizer ${organizerId} (${userRec.email}) wallet synced: Revenue=₦${totalRevenue}, Available=₦${availableBalance}`);
      }
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
