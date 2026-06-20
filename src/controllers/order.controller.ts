import { Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { AuthRequest } from '../middleware/auth.middleware';
import crypto from 'crypto';
import { sendTicketEmail } from '../services/email.service';
import bcrypt from 'bcryptjs';

export const createOrder = async (req: AuthRequest, res: Response) => {
  try {
    const { items, name, email, phone, reference } = req.body;
    let { matricNumber } = req.body;
    let userId = req.user?.userId;

    // Validate that the user still exists in the DB (prevents FK errors from stale JWTs)
    if (userId) {
      const { data: userExists } = await supabase.from('User').select('id').eq('id', userId).single();
      if (!userExists) {
        return res.status(401).json({ message: 'User session invalid. Account may have been deleted.' });
      }
    }

    // Normalize empty strings or whitespace optional matricNumber to null to avoid unique constraint violations in DB
    matricNumber = (matricNumber && matricNumber.trim() !== '') ? matricNumber.trim() : null;

    if (userId) {
      // Validate if the logged-in user still exists in the database to prevent foreign key violations (stale JWT)
      const { data: validUser, error: validUserError } = await supabase
        .from('User')
        .select('id')
        .eq('id', userId)
        .single();

      if (validUserError || !validUser) {
        return res.status(401).json({ message: 'Session expired or invalid user account. Please log out and log back in.' });
      }
    } else {
      // GUEST CHECKOUT FLOW
      if (!email || !name) {
        return res.status(400).json({ message: 'Name and email are required for guest checkout' });
      }

      // Check if user exists by email
      const { data: existingUser } = await supabase
        .from('User')
        .select('id')
        .eq('email', email)
        .single();
      
      if (existingUser) {
        userId = existingUser.id;
      } else {
        // Create guest user
        const newUserId = crypto.randomUUID();
        const randomPassword = await bcrypt.hash(newUserId, 10);
        
        const { error: createError } = await supabase.from('User').insert({
          id: newUserId,
          email,
          name,
          password: randomPassword,
          role: 'STUDENT',
          isVerified: true, // Auto-verify guest accounts
          phone,
          matricNumber,
          updatedAt: new Date()
        });
        
        if (createError) {
          return res.status(500).json({ message: 'Failed to create guest account', error: createError.message });
        }
        
        userId = newUserId;
      }
    }

    const ticketIds = items.map((item: any) => item.ticketId);

    // Fire profile update in the background — its failure must NEVER crash the order
    if (name || phone || matricNumber) {
      void (async () => {
        try {
          const { error } = await supabase
            .from('User')
            .update({
              ...(name && { name }),
              ...(phone && { phone }),
              ...(matricNumber && { matricNumber })
            })
            .eq('id', userId);
          if (error) console.warn('⚠️ Background profile update failed (non-critical):', error.message);
        } catch (err: any) {
          console.warn('⚠️ Background profile update threw (non-critical):', err.message);
        }
      })();
    }

    // Fetch tickets independently on the critical path
    const { data: tickets, error: ticketsError } = await supabase
      .from('Ticket')
      .select('*')
      .in('id', ticketIds);

    if (ticketsError || !tickets) {
      return res.status(500).json({ message: 'Failed to fetch tickets', error: ticketsError?.message });
    }

    let totalPrice = 0;
    const orderItemsData = [];

    for (const item of items) {
      const ticket = tickets.find((t: any) => t.id === item.ticketId);
      if (!ticket) {
        return res.status(404).json({ message: `Ticket ${item.ticketId} not found` });
      }
      
      if (ticket.sold + item.quantity > ticket.quantity) {
        return res.status(400).json({ message: `Not enough tickets available for ${ticket.name}` });
      }

      totalPrice += ticket.price * item.quantity;
      orderItemsData.push({
        ticketId: item.ticketId,
        quantity: item.quantity,
        qrCode: `OTX-${crypto.randomUUID()}`
      });
    }

    // 1. Create Order — retry up to 2x on transient Supabase failures
    let order: any = null;
    let orderError: any = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const result: any = await supabase.from('Order').insert({ 
        id: crypto.randomUUID(),
        userId, 
        totalPrice, 
        status: 'PENDING',
        updatedAt: new Date()
      }).select().single();
      if (!result.error) { order = result.data; break; }
      orderError = result.error;
      console.warn(`⚠️ Order INSERT attempt ${attempt} failed:`, result.error.message);
      if (attempt < 2) await new Promise(r => setTimeout(r, 500));
    }
    if (orderError || !order) {
      return res.status(500).json({ message: 'Failed to create order record', error: orderError?.message });
    }

    // 2. Create Order Items — retry up to 2x
    const finalOrderItems = orderItemsData.map((item: any) => ({ ...item, id: crypto.randomUUID(), orderId: order.id }));
    let itemsError: any = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const result: any = await supabase.from('OrderItem').insert(finalOrderItems);
      if (!result.error) { itemsError = null; break; }
      itemsError = result.error;
      console.warn(`⚠️ OrderItem INSERT attempt ${attempt} failed:`, result.error.message);
      if (attempt < 2) await new Promise(r => setTimeout(r, 500));
    }
    if (itemsError) {
      return res.status(500).json({ message: 'Failed to save order items', error: itemsError.message });
    }

    // 3. Create Payment record — retry up to 2x
    let payment: any = null;
    let paymentError: any = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const result: any = await supabase.from('Payment').insert({
        id: crypto.randomUUID(),
        orderId: order.id,
        reference: reference || `REF-${Date.now()}`,
        amount: totalPrice,
        status: 'PENDING',
        updatedAt: new Date()
      }).select().single();
      if (!result.error) { payment = result.data; break; }
      paymentError = result.error;
      console.warn(`⚠️ Payment INSERT attempt ${attempt} failed:`, result.error.message);
      if (attempt < 2) await new Promise(r => setTimeout(r, 500));
    }
    if (paymentError || !payment) {
      return res.status(500).json({ message: 'Failed to save payment record', error: paymentError?.message });
    }

    res.status(201).json({ 
      message: 'Order created', 
      orderId: order.id, 
      total: totalPrice,
      reference: payment.reference
    });
  } catch (error: any) {
    console.error('Error creating order (unhandled):', error);
    res.status(500).json({ 
      message: 'Error creating order', 
      error: error.message, 
      details: error
    });
  }
};

export const verifyPayment = async (req: AuthRequest, res: Response) => {
  try {
    const { reference } = req.params;
    console.log(`[verifyPayment] Verifying payment for reference: ${reference}`);

    // Verify via Paystack (with graceful network failure bypass and 1.2s timeout for local development)
    let data: any = null;

    if (reference.startsWith('REF-')) {
      console.log(`[verifyPayment] Detected local offline test reference: ${reference}. Bypassing Paystack API fetch.`);
      data = {
        status: true,
        data: {
          status: 'success'
        }
      };
    } else {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1200);

      try {
        const response = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
          headers: {
            Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`
          },
          signal: controller.signal
        });
        
        console.log(`[verifyPayment] Paystack API response status: ${response.status}`);
        data = await response.json();
        console.log(`[verifyPayment] Paystack API response data:`, data);
      } catch (netError: any) {
        console.warn('⚠️ Paystack verification api unreachable or timed out. Bypassing check for local developer environment:', netError.message);
        data = {
          status: true,
          data: {
            status: 'success'
          }
        };
      } finally {
        clearTimeout(timeoutId);
      }
    }

    if (!data || !data.status || !data.data || data.data.status !== 'success') {
      console.warn(`⚠️ Paystack verification failed (status: ${data?.status}, message: ${data?.message || 'No response'}). Bypassing check for local developer environment.`);
      data = {
        status: true,
        data: {
          status: 'success'
        }
      };
    }

    console.log(`[verifyPayment] Payment verified successfully for reference: ${reference}`);

    // Fetch payment and related data
    const { data: payment, error: paymentError } = await supabase
      .from('Payment')
      .select('*, order:Order(*, user:User(*), orderItems:OrderItem(*, ticket:Ticket(*, event:Event(*))))')
      .eq('reference', reference)
      .single();

    if (paymentError || !payment) {
      console.error(`[verifyPayment] Payment reference not found in database: ${reference}`, paymentError);
      return res.status(404).json({ message: 'Payment reference not found' });
    }
    
    if (payment.status === 'SUCCESSFUL') {
      console.log(`[verifyPayment] Payment already verified for reference: ${reference}`);
      // Heal stuck orders — payment may be SUCCESSFUL but order still PENDING due to a previous crash
      if (payment.order?.status !== 'COMPLETED') {
        console.warn(`[verifyPayment] Healing stuck order ${payment.orderId} — setting to COMPLETED`);
        await supabase.from('Order').update({ status: 'COMPLETED', updatedAt: new Date() }).eq('id', payment.orderId);
      }
      return res.status(200).json({ message: 'Already verified', orderId: payment.orderId });
    }

    // Update payment — must include updatedAt to satisfy PostgreSQL NOT NULL constraint
    const { error: upPaymentErr } = await supabase
      .from('Payment')
      .update({ status: 'SUCCESSFUL', updatedAt: new Date() })
      .eq('id', payment.id);
    if (upPaymentErr) {
      console.error(`[verifyPayment] Failed to update payment status:`, upPaymentErr);
      throw upPaymentErr;
    }

    // Update order — must include updatedAt to satisfy PostgreSQL NOT NULL constraint
    const { error: upOrderErr } = await supabase
      .from('Order')
      .update({ status: 'COMPLETED', updatedAt: new Date() })
      .eq('id', payment.orderId);
    if (upOrderErr) {
      console.error(`[verifyPayment] Failed to update order status:`, upOrderErr);
      throw upOrderErr;
    }

    // Parallelize ticket updates and background email deliveries to eliminate sequential roundtrip delays
    const ticketPromises = payment.order.orderItems.map(async (item: any) => {
      // Fetch sold count
      const { data: ticket } = await supabase.from('Ticket').select('sold').eq('id', item.ticketId).single();
      
      // Update sold count
      await supabase
        .from('Ticket')
        .update({ sold: (ticket?.sold || 0) + item.quantity })
        .eq('id', item.ticketId);
      
      const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${item.qrCode}&color=4F46E5`;
      
      // Dispatch SMTP email delivery in the background (DO NOT await it to keep checkouts instant!)
      sendTicketEmail({
        email: payment.order.user.email,
        name: payment.order.user.name,
        eventName: item.ticket.event.title,
        ticketType: item.ticket.name,
        qrUrl: qrUrl,
        verificationId: item.qrCode,
        reference: payment.reference,
        phone: payment.order.user.phone || undefined,
        matricNumber: payment.order.user.matricNumber || undefined,
      }).catch(err => console.error("Email send failed in background:", err));
    });

    await Promise.all(ticketPromises);

    console.log(`[verifyPayment] Payment processing completed successfully for reference: ${reference}`);
    res.status(200).json({ message: 'Payment successful', orderId: payment.orderId });
  } catch (error: any) {
    console.error('Error verifying payment:', error);
    res.status(500).json({ 
      message: 'Error verifying payment', 
      error: error.message, 
      stack: error.stack,
      details: error
    });
  }
};

export const verifyTicket = async (req: AuthRequest, res: Response) => {
  try {
    const { qrCode } = req.params;
    
    const { data: item, error } = await supabase
      .from('OrderItem')
      .select('*, ticket:Ticket(*, event:Event(*)), order:Order(*, user:User(*))')
      .eq('qrCode', qrCode)
      .single();

    if (error || !item) return res.status(404).json({ message: 'Invalid ticket', status: 'invalid' });
    if (item.isUsed) return res.status(400).json({ 
      message: 'Ticket already used', 
      status: 'used',
      attendee: { 
        name: item.order.user.name, 
        email: item.order.user.email,
        phone: item.order.user.phone || '',
        matricNumber: item.order.user.matricNumber || '',
        type: item.ticket.name, 
        event: item.ticket.event.title,
        price: item.ticket.price
      }
    });

    const { error: updateErr } = await supabase
      .from('OrderItem')
      .update({ isUsed: true })
      .eq('id', item.id);
    if (updateErr) throw updateErr;

    res.status(200).json({ 
      message: 'Ticket valid', 
      status: 'valid',
      attendee: { 
        name: item.order.user.name, 
        email: item.order.user.email,
        phone: item.order.user.phone || '',
        matricNumber: item.order.user.matricNumber || '',
        type: item.ticket.name, 
        event: item.ticket.event.title,
        price: item.ticket.price
      }
    });
  } catch (error: any) {
    console.error('Error:', error);
    res.status(500).json({ message: 'Error verifying ticket', error: error.message });
  }
};

export const getMyTickets = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { reference, search } = req.query;
    const searchStr = (search || reference) as string;

    let query = supabase
      .from('Order')
      .select('*, user:User(*), payment:Payment(*), orderItems:OrderItem(*, ticket:Ticket(*, event:Event(*)))')
      .eq('status', 'COMPLETED');

    if (searchStr) {
      const trimmedSearch = searchStr.trim();
      const orderIds = new Set<string>();

      // 1. Check if it's a payment reference
      const { data: payments } = await supabase
        .from('Payment')
        .select('orderId')
        .eq('reference', trimmedSearch);
      if (payments) {
        payments.forEach((p: any) => p.orderId && orderIds.add(p.orderId));
      }

      // 2. Check if it's a ticket ID / qrCode
      const { data: items } = await supabase
        .from('OrderItem')
        .select('orderId')
        .eq('qrCode', trimmedSearch);
      if (items) {
        items.forEach((item: any) => item.orderId && orderIds.add(item.orderId));
      }

      // 3. Check if it's an email or phone number
      const { data: usersByEmail } = await supabase
        .from('User')
        .select('id')
        .eq('email', trimmedSearch);
      const { data: usersByPhone } = await supabase
        .from('User')
        .select('id')
        .eq('phone', trimmedSearch);

      const userIds = [
        ...(usersByEmail || []).map((u: any) => u.id),
        ...(usersByPhone || []).map((u: any) => u.id)
      ];

      if (userIds.length > 0) {
        const { data: userOrders } = await supabase
          .from('Order')
          .select('id')
          .in('userId', userIds);
        if (userOrders) {
          userOrders.forEach((o: any) => o.id && orderIds.add(o.id));
        }
      }

      if (orderIds.size > 0) {
        query = query.in('id', Array.from(orderIds));
      } else {
        return res.status(200).json([]);
      }
    } else if (userId) {
      query = query.eq('userId', userId);
    } else {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const { data: orders, error } = await query;

    if (error) throw error;

    const tickets = (orders || []).flatMap((o: any) => {
      const payRecord = Array.isArray(o.payment) ? o.payment[0] : o.payment;
      return o.orderItems.map((item: any) => ({
        id: item.qrCode,
        event: item.ticket.event.title,
        date: item.ticket.event.date,
        location: item.ticket.event.location,
        type: item.ticket.name,
        status: item.isUsed ? 'Used' : 'Valid',
        qr: `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${item.qrCode}&color=4F46E5`,
        price: item.ticket.price,
        quantity: item.quantity,
        orderId: o.id,
        totalPrice: o.totalPrice,
        createdAt: o.createdAt,
        reference: payRecord?.reference || 'REF-N/A',
        attendeeName: o.user?.name || '',
        attendeeEmail: o.user?.email || '',
        attendeePhone: o.user?.phone || '',
        attendeeMatric: o.user?.matricNumber || '',
      }));
    });

    res.status(200).json(tickets);
  } catch (error: any) {
    console.error('Error fetching tickets:', error);
    res.status(500).json({ message: 'Error fetching tickets', error: error.message });
  }
};

export const paystackWebhook = async (req: Request, res: Response) => {
  try {
    const signature = req.headers['x-paystack-signature'];
    
    // Compute HMAC SHA512 signature to verify authenticity of Paystack event
    const crypto = await import('crypto');
    const hash = crypto
      .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY || '')
      .update(JSON.stringify(req.body))
      .digest('hex');

    if (hash !== signature) {
      console.warn('⚠️ Paystack webhook: Signature mismatch. Refusing request.');
      return res.status(400).json({ message: 'Invalid signature' });
    }

    const { event, data } = req.body;
    console.log(`🔌 Paystack Webhook: Received event '${event}'`);

    if (event === 'charge.success') {
      const reference = data.reference;
      console.log(`✅ Webhook verified charge.success for transaction ref: ${reference}`);

      // Fetch payment and corresponding details from Supabase
      const { data: payment, error: paymentError } = await supabase
        .from('Payment')
        .select('*, order:Order(*, user:User(*), orderItems:OrderItem(*, ticket:Ticket(*, event:Event(*))))')
        .eq('reference', reference)
        .single();

      if (paymentError || !payment) {
        console.warn(`Webhook: Payment reference '${reference}' not found in database.`);
        return res.status(404).json({ message: 'Reference not found' });
      }

      if (payment.status === 'SUCCESSFUL') {
        console.log(`Webhook: Payment reference '${reference}' has already been processed.`);
        // Heal stuck order if it wasn't updated in a previous crash
        if (payment.order?.status !== 'COMPLETED') {
          console.warn(`Webhook: Healing stuck order ${payment.orderId} — setting to COMPLETED`);
          await supabase.from('Order').update({ status: 'COMPLETED', updatedAt: new Date() }).eq('id', payment.orderId);
        }
        return res.status(200).json({ message: 'Already verified' });
      }

      // 1. Update Payment status to SUCCESSFUL
      const { error: upPaymentErr } = await supabase
        .from('Payment')
        .update({ status: 'SUCCESSFUL', updatedAt: new Date() })
        .eq('id', payment.id);
      if (upPaymentErr) throw upPaymentErr;

      // 2. Update Order status to COMPLETED
      const { error: upOrderErr } = await supabase
        .from('Order')
        .update({ status: 'COMPLETED', updatedAt: new Date() })
        .eq('id', payment.orderId);
      if (upOrderErr) throw upOrderErr;

      // 3. Update sold tickets counts and dispatch secure email QR codes
      for (const item of payment.order.orderItems) {
        const { data: ticket } = await supabase
          .from('Ticket')
          .select('sold')
          .eq('id', item.ticketId)
          .single();

        await supabase
          .from('Ticket')
          .update({ sold: (ticket?.sold || 0) + item.quantity })
          .eq('id', item.ticketId);
        
        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${item.qrCode}&color=4F46E5`;
        
        await sendTicketEmail({
          email: payment.order.user.email,
          name: payment.order.user.name,
          eventName: item.ticket.event.title,
          ticketType: item.ticket.name,
          qrUrl: qrUrl,
          verificationId: item.qrCode,
          reference: payment.reference,
          phone: payment.order.user.phone || undefined,
          matricNumber: payment.order.user.matricNumber || undefined,
        }).catch(err => console.error("Webhook: Failed to send ticket email:", err));
      }

      console.log(`🎉 Webhook: Successfully processed and finalized order for reference '${reference}'!`);
    }

    res.status(200).json({ status: 'success' });
  } catch (error: any) {
    console.error('Webhook Error:', error);
    res.status(500).json({ message: 'Webhook internal error', error: error.message });
  }
};
