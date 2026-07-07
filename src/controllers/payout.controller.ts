import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import prisma from '../config/db';
import axios from 'axios';

export const createSubaccount = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const { bankName, accountNumber, bankCode } = req.body;
    if (!bankName || !accountNumber || !bankCode) {
      return res.status(400).json({ message: 'Bank name, account number, and bank code are required' });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ message: 'User not found' });

    // Call Paystack API to create subaccount
    const paystackSecret = process.env.PAYSTACK_SECRET_KEY;
    if (!paystackSecret) {
      return res.status(500).json({ message: 'Paystack secret key is missing' });
    }

    const response = await axios.post(
      'https://api.paystack.co/subaccount',
      {
        business_name: user.name + ' Events',
        settlement_bank: bankCode,
        account_number: accountNumber,
        percentage_charge: 0, // We override this dynamically per-transaction
        description: 'Organizer payout subaccount for ' + user.name,
      },
      {
        headers: {
          Authorization: `Bearer ${paystackSecret}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!response.data || !response.data.status) {
      throw new Error(response.data?.message || 'Failed to create subaccount on Paystack');
    }

    const subaccountCode = response.data.data.subaccount_code;

    // Update user record
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        bankName,
        accountNumber,
        bankCode,
        subaccountCode,
      },
    });

    res.status(200).json({
      message: 'Subaccount created successfully',
      subaccountCode: updatedUser.subaccountCode,
    });
  } catch (error: any) {
    console.error('Create subaccount error:', error?.response?.data || error);
    res.status(500).json({
      message: 'Failed to create subaccount',
      error: error?.response?.data?.message || error.message,
    });
  }
};

export const getSubaccount = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { bankName: true, accountNumber: true, bankCode: true, subaccountCode: true },
    });

    if (!user) return res.status(404).json({ message: 'User not found' });

    res.status(200).json(user);
  } catch (error: any) {
    res.status(500).json({ message: 'Error fetching subaccount details', error: error.message });
  }
};
