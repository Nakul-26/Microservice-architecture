import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { MongoClient } from 'mongodb';
import userRoutes from './routes/userRoutes.js';

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;
const mongoUri = process.env.MONGODB_URI;
const mongoDbName = process.env.MONGODB_DB_NAME || 'app';

if (!mongoUri) {
  throw new Error('MONGODB_URI is not set');
}

app.use(express.json());
app.use(cors());

app.use('/users', userRoutes);

app.get('/', (req, res) => {
  res.send('User Service Running');
});

const client = new MongoClient(mongoUri);

const start = async () => {
  try {
    await client.connect();
    app.locals.db = client.db(mongoDbName);
    console.log('Connected to MongoDB');
    app.listen(port, () => {
      console.log(`User service listening at http://localhost:${port}`);
    });
  } catch (error) {
    console.error('Error connecting to MongoDB:', error);
  }
};

start();

process.on('SIGINT', async () => {
  await client.close();
  process.exit(0);
});
