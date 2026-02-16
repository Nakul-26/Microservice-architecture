import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import noteRoutes from './routes/noteRoutes.js';

dotenv.config();

const app = express();
const port = process.env.PORT || 3002;

app.use(express.json());
app.use(cors());
app.use('/notes', noteRoutes);

app.get('/', (req, res) => {
  res.send('Notes Service Running');
});

mongoose.connect(process.env.MONGODB_URI!)
  .then(() => {
    console.log('Connected to MongoDB');
    app.listen(port, () => {
      console.log(`Notes service listening at http://localhost:${port}`);
    });
  })
  .catch((error) => {
    console.error('Error connecting to MongoDB:', error);
  });
