import { Router } from 'express';
import { getStats, getSales, getEvents, getActivity, getDashboard, addContestant, addCategory, updateVotingSettings, getAttendees, verifyTicket } from '../controllers/organizer.controller';
import { authenticate, authorize } from '../middleware/auth.middleware';

const router = Router();

router.use(authenticate);
router.use(authorize(['ORGANIZER', 'ADMIN']));

router.get('/dashboard', getDashboard);  // ← single fast combined endpoint
router.get('/stats', getStats);
router.get('/sales', getSales);
router.get('/events', getEvents);
router.get('/activity', getActivity);
router.post('/contestants', addContestant);
router.post('/categories', addCategory);
router.put('/events/:eventId/voting-settings', updateVotingSettings);
router.get('/attendees', getAttendees);
router.post('/verify/:id', verifyTicket);

export default router;
