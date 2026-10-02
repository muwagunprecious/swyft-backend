import { Router } from 'express';
import { getStats, getSales, getEvents, getActivity, getDashboard, addContestant, addCategory, updateVotingSettings, getAttendees, verifyTicket, getWallet, requestWithdrawal } from '../controllers/organizer.controller';
import { saveBankDetails, getBankDetails } from '../controllers/payout.controller';
import { authenticate, authorize } from '../middleware/auth.middleware';

const router = Router();

router.use(authenticate);
router.use(authorize(['ORGANIZER', 'ADMIN']));

router.get('/dashboard', getDashboard);  // ← single fast combined endpoint
router.get('/stats', getStats);
router.get('/sales', getSales);
router.get('/events', getEvents);
router.get('/activity', getActivity);
router.get('/wallet', getWallet);
router.post('/withdraw', requestWithdrawal);
router.get('/bank-details', getBankDetails);
router.post('/bank-details', saveBankDetails);
router.put('/bank-details', saveBankDetails);
router.get('/subaccount', getBankDetails);
router.post('/subaccount', saveBankDetails);
router.post('/contestants', addContestant);
router.post('/categories', addCategory);
router.put('/events/:eventId/voting-settings', updateVotingSettings);
router.get('/attendees', getAttendees);
router.post('/verify/:id', verifyTicket);

export default router;
