import { Router } from 'express';
import { createOrder, getMyTickets, verifyPayment, verifyTicket, paystackWebhook } from '../controllers/order.controller';
import { authenticate, optionalAuthenticate } from '../middleware/auth.middleware';

const router = Router();

// Webhook route is public (called by Paystack)
router.post('/webhook', paystackWebhook);

// Order creation can be done by guests
router.post('/', optionalAuthenticate, createOrder);
router.post('/verify-payment/:reference', optionalAuthenticate, verifyPayment);

// These routes require authentication
router.post('/verify-ticket/:qrCode', authenticate, verifyTicket);
router.get('/my-tickets', optionalAuthenticate, getMyTickets);

export default router;
