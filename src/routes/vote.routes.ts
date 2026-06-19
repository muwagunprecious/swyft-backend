import { Router } from 'express';
import { castVote, getResults, tweakVotes } from '../controllers/vote.controller';
import { authenticate, authorize } from '../middleware/auth.middleware';

const router = Router();

router.post('/cast', castVote);
router.get('/results/:eventId', getResults);
router.post('/tweak/:contestantId', authenticate, authorize(['ORGANIZER', 'ADMIN']), tweakVotes);

export default router;
