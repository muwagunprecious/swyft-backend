const bcrypt = require('bcryptjs');

async function test() {
  try {
    const pass = 'password123';
    const hash = await bcrypt.hash(pass, 10);
    console.log('Hash generated');
    const match = await bcrypt.compare(pass, hash);
    console.log('Match result:', match);
  } catch (e) {
    console.error('Error:', e);
  }
}

test();
