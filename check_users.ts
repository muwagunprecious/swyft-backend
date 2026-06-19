import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function check() {
  const users = await prisma.user.findMany();
  console.log('Users in DB:', users.map(u => ({ id: u.id, email: u.email, role: u.role })));
}

check().catch(console.error).finally(() => prisma.$disconnect());
