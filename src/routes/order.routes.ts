import { Router } from 'express';
import { createOrder, getMyTickets, verifyPayment, verifyTicket, paystackWebhook } from '../controllers/order.controller';
import { authenticate, optionalAuthenticate } from '../middleware/auth.middleware';

const router = Router();

// Webhook route is public (called by Paystack)
router.post('/webhook', paystackWebhook);

// Order creation can be done by guests
router.post('/', optionalAuthenticate, createOrder);
router.post('/verify-payment/:reference', optionalAuthenticate, verifyPayment);

// Ticket verification routes (GET preview details upon QR scan, POST check-in/admit)
router.get('/verify-ticket/:qrCode', verifyTicket);
router.post('/verify-ticket/:qrCode', optionalAuthenticate, verifyTicket);
router.get('/my-tickets', optionalAuthenticate, getMyTickets);

export default router;
