import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { supabase } from '../config/supabase';
import axios from 'axios';

export const saveBankDetails = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const { bankName, accountNumber, bankCode } = req.body;
    if (!bankName || !accountNumber) {
      return res.status(400).json({ message: 'Bank name and account number are required' });
    }

    const cleanAccount = String(accountNumber).trim().replace(/\D/g, '');
    if (cleanAccount.length !== 10) {
      return res.status(400).json({ message: 'Please enter a valid 10-digit account number' });
    }

    // 1. Fetch current user
    const { data: user, error: userError } = await supabase
      .from('User')
      .select('id, name, email, subaccountCode')
      .eq('id', userId)
      .single();

    if (userError || !user) {
      return res.status(404).json({ message: 'User not found' });
    }

    let subaccountCode = user.subaccountCode || null;

    // 2. Attempt Paystack Subaccount creation if secret key and bank code exist
    const paystackSecret = process.env.PAYSTACK_SECRET_KEY;
    if (paystackSecret && bankCode) {
      try {
        const paystackRes = await axios.post(
          'https://api.paystack.co/subaccount',
          {
            business_name: `${user.name} Events`,
            settlement_bank: bankCode,
            account_number: cleanAccount,
            percentage_charge: 0,
            description: `Organizer payout subaccount for ${user.name}`,
          },
          {
            headers: {
              Authorization: `Bearer ${paystackSecret}`,
              'Content-Type': 'application/json',
            },
            timeout: 6000,
          }
        );

        if (paystackRes.data?.status && paystackRes.data?.data?.subaccount_code) {
          subaccountCode = paystackRes.data.data.subaccount_code;
        }
      } catch (paystackErr: any) {
        console.warn('Paystack subaccount notice (bank details saved directly to DB):', paystackErr?.response?.data || paystackErr.message);
      }
    }

    // 3. Always save bank details to database
    const { data: updatedUser, error: updateError } = await supabase
      .from('User')
      .update({
        bankName,
        accountNumber: cleanAccount,
        bankCode: bankCode || null,
        subaccountCode: subaccountCode || null,
        updatedAt: new Date().toISOString(),
      })
      .eq('id', userId)
      .select('bankName, accountNumber, bankCode, subaccountCode')
      .single();

    if (updateError) {
      console.error('Failed to update user bank details:', updateError);
      return res.status(500).json({ message: 'Failed to save bank details in database', error: updateError.message });
    }

    res.status(200).json({
      message: 'Bank account details saved successfully!',
      bankName: updatedUser.bankName,
      accountNumber: updatedUser.accountNumber,
      bankCode: updatedUser.bankCode,
      subaccountCode: updatedUser.subaccountCode,
    });
  } catch (error: any) {
    console.error('Save bank details error:', error);
    res.status(500).json({ message: 'Error saving bank details', error: error.message });
  }
};

export const getBankDetails = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const { data: user, error } = await supabase
      .from('User')
      .select('name, bankName, accountNumber, bankCode, subaccountCode')
      .eq('id', userId)
      .single();

    if (error || !user) return res.status(404).json({ message: 'User not found' });

    res.status(200).json(user);
  } catch (error: any) {
    res.status(500).json({ message: 'Error fetching bank details', error: error.message });
  }
};

// Aliases for backwards compatibility with existing frontend calls
export const createSubaccount = saveBankDetails;
export const getSubaccount = getBankDetails;
