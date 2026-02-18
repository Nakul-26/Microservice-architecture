import express from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import mongoose from 'mongoose';
import Note from '../models/Note.js';

const router = express.Router();
const jwtSecret = process.env.JWT_SECRET ?? 'dev-secret-change-me';
type UserRole = 'admin' | 'user';
type Requester = { requesterId: string; requesterRole: UserRole };
type JwtPayload = { sub?: unknown; role?: unknown };
const buildNoteIdQuery = (id: string) => ({
  $or: [{ _id: id }, { _id: new mongoose.Types.ObjectId(id) }],
});

const verifyJwtPayload = (token: string, secret: string): JwtPayload | null => {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }

  const [headerB64, payloadB64, signatureB64] = parts;

  try {
    const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8')) as { alg?: string };
    if (header.alg !== 'HS256') {
      return null;
    }

    const signedData = `${headerB64}.${payloadB64}`;
    const expectedSignature = createHmac('sha256', secret).update(signedData).digest('base64url');
    const expectedBuffer = Buffer.from(expectedSignature);
    const providedBuffer = Buffer.from(signatureB64);

    if (expectedBuffer.length !== providedBuffer.length) {
      return null;
    }

    if (!timingSafeEqual(expectedBuffer, providedBuffer)) {
      return null;
    }

    return JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as JwtPayload;
  } catch {
    return null;
  }
};

const getRequester = (req: express.Request): Requester | null => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.slice('Bearer '.length);

  const payload = verifyJwtPayload(token, jwtSecret);
  if (!payload) {
    return null;
  }

  const requesterId = typeof payload.sub === 'string' ? payload.sub : '';
  if (!requesterId) {
    return null;
  }

  const requesterRole: UserRole = payload.role === 'admin' ? 'admin' : 'user';
  return { requesterId, requesterRole };
};

router.get('/', async (req, res) => {
  const requester = getRequester(req);
  if (!requester) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  const { requesterId, requesterRole } = requester;

  const { userId } = req.query;

  if (userId && (typeof userId !== 'string' || !mongoose.Types.ObjectId.isValid(userId))) {
    return res.status(400).json({ message: 'Invalid user id' });
  }

  try {
    const filter =
      requesterRole === 'admin'
        ? userId
          ? { userId }
          : {}
        : { userId: requesterId };
    const notes = await Note.find(filter).sort({ createdAt: -1 });
    res.json(notes);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching notes', error });
  }
});

router.post('/', async (req, res) => {
  const requester = getRequester(req);
  if (!requester) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  const { requesterId, requesterRole } = requester;

  const rawUserId = typeof req.body?.userId === 'string' ? req.body.userId : '';
  const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
  const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
  const userId = requesterRole === 'admin' ? rawUserId : requesterId;

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
  const requester = getRequester(req);
  if (!requester) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  const { requesterId, requesterRole } = requester;

  const { id } = req.params;
  const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
  const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';

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

    const filter =
      requesterRole === 'admin'
        ? buildNoteIdQuery(id)
        : { ...buildNoteIdQuery(id), userId: requesterId };

    const note = await Note.findOneAndUpdate(filter, update, {
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
  const requester = getRequester(req);
  if (!requester) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  const { requesterId, requesterRole } = requester;

  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ message: 'Invalid note id' });
  }

  try {
    const filter =
      requesterRole === 'admin'
        ? buildNoteIdQuery(id)
        : { ...buildNoteIdQuery(id), userId: requesterId };

    const result = await Note.findOneAndDelete(filter);
    if (!result) {
      return res.status(404).json({ message: 'Note not found' });
    }
    res.json({ message: 'Note deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting note', error });
  }
});

export default router;
