import express, { Request, Response } from 'express';
import cors from 'cors';
import morgan from 'morgan';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenv.config();

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 5000;

import authRoutes from './routes/auth.routes';
import eventRoutes from './routes/event.routes';
import orderRoutes from './routes/order.routes';
import voteRoutes from './routes/vote.routes';
import organizerRoutes from './routes/organizer.routes';
import adminRoutes from './routes/admin.routes';

import path from 'path';

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(morgan('dev'));
app.use('/uploads', express.static(path.join(process.cwd(), 'public/uploads')));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/votes', voteRoutes);
app.use('/api/organizer', organizerRoutes);
app.use('/api/admin', adminRoutes);

// Health Check
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'OK', message: 'OTIX API is running' });
});

// Root Route
app.get('/', (req: Request, res: Response) => {
  res.status(200).json({ status: 'OK', message: 'Welcome to OTIX Backend API' });
});

// Start Server
if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`🚀 OTIX Backend running on http://localhost:${PORT}`);
  });
}

export { prisma };
module.exports = app;
