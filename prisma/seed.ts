import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  // Clear existing data
  await prisma.vote.deleteMany();
  await prisma.contestant.deleteMany();
  await prisma.voteCategory.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.order.deleteMany();
  await prisma.ticket.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();

  // Create standard roles/test accounts if absolutely necessary for initial setup
  // but keeping them generic as per "Remove Demo Identity Fields" instruction.
  const hashedPassword = await bcrypt.hash('Admin@OTIX2026', 12);
  
  await prisma.user.create({
    data: {
      email: 'admin@otix.com',
      password: hashedPassword,
      name: 'System Administrator',
      role: 'ORGANIZER',
    },
  });

  console.log('Seed: Database cleared and baseline administrator created.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
