import { Router } from 'express';
import { getAllEvents, getEventById, createEvent } from '../controllers/event.controller';
import { authenticate, authorize } from '../middleware/auth.middleware';

const router = Router();

router.get('/', getAllEvents);
router.get('/:id', getEventById);
router.post('/', authenticate, authorize(['ORGANIZER', 'ADMIN']), createEvent);

export default router;
