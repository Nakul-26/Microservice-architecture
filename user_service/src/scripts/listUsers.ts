import dotenv from 'dotenv';
import { MongoClient } from 'mongodb';

dotenv.config();

const mongoUri = process.env.MONGODB_URI;
const mongoDbName = process.env.MONGODB_DB_NAME ?? 'app';

if (!mongoUri) {
  console.error('MONGODB_URI is not set');
  process.exit(1);
}

const client = new MongoClient(mongoUri);

const run = async () => {
  try {
    await client.connect();
    const db = client.db(mongoDbName);

    const users = await db
      .collection('users')
      .find({}, { projection: { password: 0 } })
      .sort({ createdAt: -1 })
      .toArray();

    if (users.length === 0) {
      console.log('No users found.');
      return;
    }

    const rows = users.map((user) => ({
      id: user._id?.toString(),
      name: user.name ?? '',
      email: user.email ?? '',
      role: user.role === 'admin' ? 'admin' : 'user',
      createdAt: user.createdAt ? new Date(user.createdAt).toISOString() : '',
      updatedAt: user.updatedAt ? new Date(user.updatedAt).toISOString() : '',
    }));

    console.table(rows);
  } catch (error) {
    console.error('Failed to list users:', error);
    process.exitCode = 1;
  } finally {
    await client.close();
  }
};

void run();
