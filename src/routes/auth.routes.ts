import { Router } from 'express';
import { register, login, verifyEmail, updateProfile, changePassword, getMe } from '../controllers/auth.controller';
import { authenticate } from '../middleware/auth.middleware';
const router = Router();

router.post('/register', register);
router.post('/login', login);
router.post('/verify-email', verifyEmail);
router.get('/me', authenticate, getMe);
router.patch('/profile', authenticate, updateProfile);
router.post('/change-password', authenticate, changePassword);

export default router;
