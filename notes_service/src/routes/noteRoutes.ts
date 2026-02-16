import express from 'express';
import mongoose from 'mongoose';
import Note from '../models/Note.js';

const router = express.Router();

router.get('/', async (req, res) => {
  const { userId } = req.query;

  if (userId && (typeof userId !== 'string' || !mongoose.Types.ObjectId.isValid(userId))) {
    return res.status(400).json({ message: 'Invalid user id' });
  }

  try {
    const filter = userId ? { userId } : {};
    const notes = await Note.find(filter).sort({ createdAt: -1 });
    res.json(notes);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching notes', error });
  }
});

router.post('/', async (req, res) => {
  const { userId, title, content } = req.body;

  if (!userId || !title || !content) {
    return res.status(400).json({ message: 'User id, title and content are required' });
  }

  if (!mongoose.Types.ObjectId.isValid(userId)) {
    return res.status(400).json({ message: 'Invalid user id' });
  }

  try {
    const note = await Note.create({ userId, title, content });
    res.status(201).json(note);
  } catch (error) {
    res.status(500).json({ message: 'Error creating note', error });
  }
});

router.patch('/:id', async (req, res) => {
  const { id } = req.params;
  const { title, content } = req.body;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ message: 'Invalid note id' });
  }

  if (!title && !content) {
    return res.status(400).json({ message: 'Provide title or content to update' });
  }

  try {
    const update: Record<string, string> = {};
    if (title) {
      update.title = title;
    }
    if (content) {
      update.content = content;
    }

    const note = await Note.findByIdAndUpdate(id, update, {
      new: true,
      runValidators: true,
    });

    if (!note) {
      return res.status(404).json({ message: 'Note not found' });
    }

    res.json(note);
  } catch (error) {
    res.status(500).json({ message: 'Error updating note', error });
  }
});

router.delete('/:id', async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ message: 'Invalid note id' });
  }

  try {
    const result = await Note.findByIdAndDelete(id);
    if (!result) {
      return res.status(404).json({ message: 'Note not found' });
    }
    res.json({ message: 'Note deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting note', error });
  }
});

export default router;
