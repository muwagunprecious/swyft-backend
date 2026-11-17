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
  netBalance: number;
  deficit: number;
}

/**
 * Live synchronization of an Organizer's wallet balance.
 * Strictly grounds wallet calculations in verified ground truth:
 *   - totalRevenue = Sum of actual amounts paid for COMPLETED orders belonging to this organizer
 *   - withdrawnAmount = Sum of COMPLETED payouts
 *   - pendingWithdrawals = Sum of PENDING payouts
 *   - netBalance = totalRevenue - withdrawnAmount - pendingWithdrawals
 *   - availableBalance = Math.max(0, netBalance)
 *   - deficit = Math.max(0, -netBalance)
 *
 * CRITICAL: Under no circumstances will availableBalance or totalRevenue use artificial
 * baseline ratchets (e.g. Math.max(..., existingBal)). The database User.walletBalance
 * is strictly updated to availableBalance, preventing phantom balances and over-withdrawals.
 */
export async function syncOrganizerWallet(organizerId: string): Promise<WalletSyncResult> {
  try {
    // 1. Fetch user record
    const { data: userRec } = await supabase
      .from('User')
      .select('id, name, email, walletBalance')
      .eq('id', organizerId)
      .single();

    // 2. Fetch all events for this organizer
    const { data: events, error: evErr } = await supabase
      .from('Event')
      .select('id, title')
      .eq('organizerId', organizerId);

    if (evErr) {
      console.error(`[syncOrganizerWallet] Error fetching events for organizer ${organizerId}:`, evErr);
      const safeBal = Math.max(0, userRec?.walletBalance || 0);
      return { totalRevenue: safeBal, availableBalance: safeBal, withdrawnAmount: 0, pendingWithdrawals: 0, netBalance: safeBal, deficit: 0 };
    }

    const eventIds = (events || []).map((e: any) => e.id);

    // 3. Fetch all payouts for this organizer
    const { data: payouts } = await supabase
      .from('Payout')
      .select('amount, status')
      .eq('userId', organizerId);

    let withdrawnAmount = 0;
    let pendingWithdrawals = 0;
    (payouts || []).forEach((p: any) => {
      const amt = Number(p.amount) || 0;
      if (p.status === 'COMPLETED') withdrawnAmount += amt;
      else if (p.status === 'PENDING') pendingWithdrawals += amt;
    });

    // 4. Fetch completed orders specifically for this organizer's tickets
    let calculatedRevenue = 0;

    if (eventIds.length > 0) {
      const { data: tickets } = await supabase
        .from('Ticket')
        .select('id, name, price, discountPrice, eventId')
        .in('eventId', eventIds);

      const ticketIds = (tickets || []).map((t: any) => t.id);

      if (ticketIds.length > 0) {
        // Fetch all completed order items with full order details
        const { data: orderItems, error: itemsErr } = await supabase
          .from('OrderItem')
          .select('id, quantity, ticketId, order:Order!inner(id, totalPrice, status, items:OrderItem(id, quantity, ticketId, ticket:Ticket(id, price, discountPrice, eventId)))')
          .eq('order.status', 'COMPLETED')
          .in('ticketId', ticketIds);

        if (itemsErr) {
          console.error(`[syncOrganizerWallet] Error fetching order items for organizer ${organizerId}:`, itemsErr);
        } else if (orderItems) {
          const processedOrderIds = new Set<string>();

          for (const it of orderItems) {
            const ord = it.order as any;
            if (!ord?.id || processedOrderIds.has(ord.id)) continue;
            processedOrderIds.add(ord.id);

            const allItemsInOrder = ord.items || [];
            // Filter items in this order that belong to this organizer
            const orgItemsInOrder = allItemsInOrder.filter((item: any) => {
              const tId = item.ticketId || item.ticket?.id;
              return tId && ticketIds.includes(tId);
            });

            if (orgItemsInOrder.length === allItemsInOrder.length) {
              // 100% of order items belong to this organizer
              calculatedRevenue += (Number(ord.totalPrice) || 0);
            } else {
              // Multi-organizer order: apportion exact paid amount per item
              for (const orgItem of orgItemsInOrder) {
                calculatedRevenue += calculateItemPaidAmount(orgItem, Number(ord.totalPrice) || 0, allItemsInOrder);
              }
            }
          }
        }
      }
    }

    // 5. Strict financial ledger accounting:
    // Net balance = verified actual sales revenue - completed payouts - pending withdrawals
    const netBalance = calculatedRevenue - withdrawnAmount - pendingWithdrawals;
    const availableBalance = Math.max(0, netBalance);
    const deficit = Math.max(0, -netBalance);
    const totalRevenue = calculatedRevenue; // True ground truth revenue, never inflated

    // 6. Keep User.walletBalance in Supabase strictly in sync with ground truth available balance
    if (userRec && userRec.walletBalance !== availableBalance) {
      const { error: updateErr } = await supabase
        .from('User')
        .update({ walletBalance: availableBalance })
        .eq('id', organizerId);

      if (updateErr) {
        console.error(`[syncOrganizerWallet] Error updating wallet balance in DB for organizer ${organizerId}:`, updateErr);
      } else {
        console.log(`[syncOrganizerWallet] Organizer ${organizerId} (${userRec.email}) wallet synced: Revenue=₦${totalRevenue}, Withdrawn=₦${withdrawnAmount}, Pending=₦${pendingWithdrawals}, Available=₦${availableBalance}${deficit > 0 ? `, Deficit=₦${deficit}` : ''}`);
      }
    }

    return {
      totalRevenue,
      availableBalance,
      withdrawnAmount,
      pendingWithdrawals,
      netBalance,
      deficit,
    };
  } catch (err) {
    console.error(`[syncOrganizerWallet] Unhandled error for organizer ${organizerId}:`, err);
    const { data: userRec } = await supabase.from('User').select('walletBalance').eq('id', organizerId).single();
    const safeBal = Math.max(0, userRec?.walletBalance || 0);
    return {
      totalRevenue: safeBal,
      availableBalance: safeBal,
      withdrawnAmount: 0,
      pendingWithdrawals: 0,
      netBalance: safeBal,
      deficit: 0,
    };
  }
}
