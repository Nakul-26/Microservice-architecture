import jwt from 'jsonwebtoken';

export type UserRole = 'admin' | 'user';

export type Requester = {
  requesterId: string;
  requesterRole: UserRole;
  requesterEmail: string;
};

const jwtSecret = process.env.JWT_SECRET ?? 'dev-secret-change-me';

export const signUserToken = (payload: {
  sub: string;
  email: string;
  name: string;
  role: UserRole;
}) =>
  jwt.sign(payload, jwtSecret, {
    expiresIn: '1h',
  });

export const getRequesterFromAuthorizationHeader = (
  authHeader: string | undefined
): Requester | null => {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.slice('Bearer '.length);

  try {
    const decoded = jwt.verify(token, jwtSecret);
    if (typeof decoded === 'string') {
      return null;
    }

    const requesterId = typeof decoded.sub === 'string' ? decoded.sub : '';
    const requesterEmail = typeof decoded.email === 'string' ? decoded.email : '';
    if (!requesterId) {
      return null;
    }

    const requesterRole: UserRole = decoded.role === 'admin' ? 'admin' : 'user';
    return { requesterId, requesterRole, requesterEmail };
  } catch {
    return null;
  }
};
