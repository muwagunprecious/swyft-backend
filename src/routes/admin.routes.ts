import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.middleware';
import {
  getStats,
  getUsers,
  toggleBan,
  getEvents,
  toggleEventStatus,
  getPayouts,
  releasePayout,
  getTickets,
  getUserAuditTrail,
} from '../controllers/admin.controller';

const router = Router();

// Protect all admin routes with authentication and ADMIN role check
router.use(authenticate, authorize(['ADMIN']));

router.get('/stats', getStats);
router.get('/users', getUsers);
router.post('/users/:userId/ban', toggleBan);
router.get('/events', getEvents);
router.post('/events/:eventId/toggle-status', toggleEventStatus);
router.get('/payouts', getPayouts);
router.post('/payouts/:payoutId/release', releasePayout);
router.get('/tickets', getTickets);
router.get('/users/:userId/audit', getUserAuditTrail);

export default router;
