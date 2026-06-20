import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { supabase } from '../config/supabase';

export const register = async (req: Request, res: Response) => {
  try {
    const { email, password, name, role, university } = req.body;
    let { matricNumber } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({ message: 'Email, password and name are required' });
    }

    // Normalize empty strings or whitespace optional matricNumber to null
    matricNumber = (matricNumber && matricNumber.trim() !== '') ? matricNumber.trim() : null;

    // Check if user exists
    const { data: existingUser, error: lookupError } = await supabase
      .from('User')
      .select('id')
      .eq('email', email)
      .single();

    // PGRST116 = no rows found — that's fine, means user doesn't exist
    if (lookupError && lookupError.code !== 'PGRST116') {
      console.error('Supabase lookup error:', JSON.stringify(lookupError));
      return res.status(500).json({ message: 'Database error during lookup', error: lookupError.message, code: lookupError.code });
    }

    if (existingUser) {
      return res.status(400).json({ message: 'User already exists with this email' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);
    const userId = globalThis.crypto?.randomUUID() || Math.random().toString(36).substring(2) + Date.now().toString(36);

    // Create user (auto-verified — email verification disabled)
    const { data: user, error } = await supabase
      .from('User')
      .insert({
        id: userId,
        email,
        password: hashedPassword,
        name,
        role: role || 'STUDENT',
        matricNumber,
        university: university || null,
        isVerified: true,
        updatedAt: new Date(),
      })
      .select()
      .single();

    if (error) {
      console.error('Supabase insert error:', JSON.stringify(error));
      return res.status(500).json({ message: 'Failed to create account', error: error.message, code: error.code, details: error.details, hint: error.hint });
    }

    res.status(201).json({ 
      message: 'Account created successfully! You can now log in.', 
      userId: user.id 
    });
  } catch (error: any) {
    console.error('Register error:', error);
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};

export const verifyEmail = async (req: Request, res: Response) => {
  try {
    const { email, code } = req.body;

    const { data: user, error } = await supabase
      .from('User')
      .select('*')
      .eq('email', email)
      .single();

    if (error || !user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.verificationCode !== code) {
      return res.status(400).json({ message: 'Invalid verification code' });
    }

    // Update user to verified
    const { error: updateError } = await supabase
      .from('User')
      .update({ isVerified: true, verificationCode: null })
      .eq('id', user.id);

    if (updateError) throw updateError;

    res.status(200).json({ message: 'Account verified successfully! You can now log in.' });
  } catch (error: any) {
    console.error('Error:', error);
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};

export const login = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    const { data: user, error } = await supabase
      .from('User')
      .select('*')
      .eq('email', email)
      .single();

    if (error || !user) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    if (user.isBanned) {
      return res.status(403).json({ message: 'Access denied: Your account has been suspended by an administrator.' });
    }

    const token = jwt.sign(
      { userId: user.id, role: user.role },
      process.env.JWT_SECRET as string,
      { expiresIn: '7d' }
    );

    res.status(200).json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        university: user.university || null,
      },
    });
  } catch (error: any) {
    console.error('Error:', error);
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};

export const updateProfile = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.userId;
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const { university } = req.body;

    if (!university || university.trim() === '') {
      return res.status(400).json({ message: 'University is required' });
    }

    const { data: updatedUser, error } = await supabase
      .from('User')
      .update({ university: university.trim(), updatedAt: new Date() })
      .eq('id', userId)
      .select('id, email, name, role, university')
      .single();

    if (error) throw error;

    res.status(200).json({ message: 'Profile updated successfully', user: updatedUser });
  } catch (error: any) {
    console.error('Error:', error);
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};
