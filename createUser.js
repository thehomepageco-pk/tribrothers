const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const User = require('./models/User');

// One-off utility to create an admin user without hard-coding credentials.
// Usage (example):
//   ADMIN_USERNAME="admin" ADMIN_PASSWORD="StrongPass123!" node createUser.js

mongoose.connect('mongodb://127.0.0.1:27017/software');

async function createUser() {
  const username = (process.env.ADMIN_USERNAME || '').trim();
  const password = process.env.ADMIN_PASSWORD || '';

  if (!username || !password) {
    console.error('❌ ADMIN_USERNAME and ADMIN_PASSWORD environment variables are required.');
    process.exit(1);
  }

  const existing = await User.findOne({ username });
  if (existing) {
    console.error(`❌ User "${username}" already exists. No changes made.`);
    process.exit(1);
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const user = new User({
    username,
    password: hashedPassword,
    role: 'admin',
  });
  await user.save();
  console.log(`✅ Admin user "${username}" created`);
  mongoose.disconnect();
}

createUser().catch(err => {
  console.error('❌ Failed to create user:', err);
  process.exit(1);
});
