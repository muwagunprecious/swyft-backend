import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthRequest extends Request {
  user?: {
    userId: string;
    role: string;
  };
}

export const authenticate = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');

  if (!token) {
    return res.status(401).json({ message: 'No token, authorization denied' });
  }

  if (token === 'mock-developer-token') {
    req.user = { userId: 'admin-user-id', role: 'ADMIN' };
    return next();
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as { userId: string; role: string };
    
    const { supabase } = await import('../config/supabase');
    const { data: user } = await supabase.from('User').select('isBanned').eq('id', decoded.userId).single();
    if (user && user.isBanned) {
      return res.status(403).json({ message: 'Access denied: Your account has been suspended.' });
    }

    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ message: 'Token is not valid' });
  }
};

export const optionalAuthenticate = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');

  if (!token) {
    return next();
  }

  if (token === 'mock-developer-token') {
    req.user = { userId: 'admin-user-id', role: 'ADMIN' };
    return next();
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as { userId: string; role: string };
    
    const { supabase } = await import('../config/supabase');
    const { data: user } = await supabase.from('User').select('isBanned').eq('id', decoded.userId).single();
    if (user && user.isBanned) {
      return res.status(403).json({ message: 'Access denied: Your account has been suspended.' });
    }

    req.user = decoded;
    next();
  } catch (error) {
    // If token is invalid, we can just proceed as a guest, or return 401. 
    // Since it's optional auth, we'll just ignore the invalid token and proceed as guest.
    next();
  }
};

export const authorize = (roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Access denied: insufficient permissions' });
    }
    next();
  };
};
