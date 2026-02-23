import dotenv from 'dotenv';
import { MongoClient, ObjectId } from 'mongodb';
import bcrypt from 'bcrypt';

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
    id: getArg('id').trim(),
    email: getArg('email').trim().toLowerCase(),
    password: getArg('password'),
  };
};

const client = new MongoClient(mongoUri);
const parsedBcryptSaltRounds = Number.parseInt(process.env.BCRYPT_SALT_ROUNDS ?? '10', 10);
const bcryptSaltRounds = Number.isFinite(parsedBcryptSaltRounds) ? parsedBcryptSaltRounds : 10;

const run = async () => {
  const { id, email, password } = parseArgs();

  if (!password || (!id && !email)) {
    console.error('Missing required arguments: provide --password and either --id or --email.');
    process.exit(1);
  }

  if (id && !ObjectId.isValid(id)) {
    console.error(`Invalid ObjectId: "${id}"`);
    process.exit(1);
  }

  try {
    await client.connect();
    const db = client.db(mongoDbName);
    const users = db.collection('users');

    const filter = id ? { _id: new ObjectId(id) } : { email };

    const hashedPassword = await bcrypt.hash(password, bcryptSaltRounds);

    const result = await users.updateOne(
      filter,
      { $set: { password: hashedPassword, updatedAt: new Date() } }
    );

    if (result.matchedCount === 0) {
      console.error('User not found.');
      process.exitCode = 1;
      return;
    }

    console.log('Password updated successfully.');
  } catch (error) {
    console.error('Failed to change password:', error);
    process.exitCode = 1;
  } finally {
    await client.close();
  }
};

void run();
