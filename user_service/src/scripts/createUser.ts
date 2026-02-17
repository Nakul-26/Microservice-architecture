import dotenv from 'dotenv';
import { MongoClient } from 'mongodb';

dotenv.config();

const mongoUri = process.env.MONGODB_URI;
const mongoDbName = process.env.MONGODB_DB_NAME ?? 'app';

if (!mongoUri) {
  console.error('MONGODB_URI is not set');
  process.exit(1);
}

const parseArgs = () => {
  const args = process.argv.slice(2);
  const getArg = (name: string) => {
    const index = args.indexOf(`--${name}`);
    if (index === -1) return '';
    return args[index + 1] ?? '';
  };

  return {
    name: getArg('name').trim(),
    email: getArg('email').trim().toLowerCase(),
    password: getArg('password'),
    role: getArg('role').trim().toLowerCase(),
  };
};

const client = new MongoClient(mongoUri);

const run = async () => {
  const { name, email, password, role } = parseArgs();
  const normalizedRole = role === 'admin' ? 'admin' : 'user';

  if (!name || !email || !password) {
    console.error(
      'Usage: npm run users:create -- --name "Jane Doe" --email "jane@example.com" --password "secret" [--role "admin|user"]'
    );
    process.exit(1);
  }

  try {
    await client.connect();
    const db = client.db(mongoDbName);
    const users = db.collection('users');

    const existing = await users.findOne({ email });
    if (existing) {
      console.error(`User with email "${email}" already exists.`);
      process.exitCode = 1;
      return;
    }

    const result = await users.insertOne({
      name,
      email,
      password,
      role: normalizedRole,
      createdAt: new Date(),
    });

    console.log(`User created successfully. id=${result.insertedId.toString()}`);
  } catch (error) {
    console.error('Failed to create user:', error);
    process.exitCode = 1;
  } finally {
    await client.close();
  }
};

void run();
