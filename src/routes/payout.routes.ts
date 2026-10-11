import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { saveBankDetails, getBankDetails } from '../controllers/payout.controller';

const router = Router();

router.use(authenticate);

router.get('/bank-details', getBankDetails);
router.post('/bank-details', saveBankDetails);
router.put('/bank-details', saveBankDetails);
router.get('/subaccount', getBankDetails);
router.post('/subaccount', saveBankDetails);

export default router;
