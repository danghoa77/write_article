import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

@Injectable()
export class FirebaseService {
  private app(): App {
    const existing = getApps().find((app) => app.name === 'auto-write-backend');
    if (existing) return existing;
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!raw?.trim())
      throw new ServiceUnavailableException(
        'missing FIREBASE_SERVICE_ACCOUNT_JSON',
      );
    try {
      const credentials = JSON.parse(raw);
      if (
        !credentials.project_id ||
        !credentials.client_email ||
        !credentials.private_key
      )
        throw new Error('Missing service-account fields');
      return initializeApp(
        {
          projectId: credentials.project_id,
          credential: cert({
            projectId: credentials.project_id,
            clientEmail: credentials.client_email,
            privateKey: credentials.private_key.replace(/\\n/g, '\n'),
          }),
        },
        'auto-write-backend',
      );
    } catch {
      throw new ServiceUnavailableException(
        'Invalid FIREBASE_SERVICE_ACCOUNT_JSON; check downloaded Firebase service-account JSON',
      );
    }
  }

  database() {
    return getFirestore(this.app());
  }

  async user(token: string) {
    const auth = getAuth(this.app());
    try {
      return await auth.verifyIdToken(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired Firebase ID token');
    }
  }
}
