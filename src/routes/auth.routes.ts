import { Router } from 'express';
import { register, login, verifyEmail, updateProfile } from '../controllers/auth.controller';
import { authenticate } from '../middleware/auth.middleware';
const router = Router();

router.post('/register', register);
router.post('/login', login);
router.post('/verify-email', verifyEmail);
router.patch('/profile', authenticate, updateProfile);

export default router;
