import { Router } from 'express';
import { getAllEvents, getEventById, createEvent, getEventBanner, getTicketQrImage } from '../controllers/event.controller';
import { authenticate, authorize } from '../middleware/auth.middleware';

const router = Router();

router.get('/', getAllEvents);
router.get('/qr/image', getTicketQrImage);
router.get('/:id/banner', getEventBanner);
router.get('/:id', getEventById);
router.post('/', authenticate, authorize(['ORGANIZER', 'ADMIN']), createEvent);

export default router;
