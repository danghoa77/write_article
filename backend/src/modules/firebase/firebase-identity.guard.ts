import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { FirebaseService } from './firebase.service.js';

@Injectable()
export class FirebaseIdentityGuard implements CanActivate {
  constructor(private readonly firebase: FirebaseService) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    const match = /^Bearer\s+(\S+)$/i.exec(request.headers.authorization ?? '');
    if (!match)
      throw new UnauthorizedException(
        'Firebase sign-in required to manage saved settings',
      );
    request.firebaseUser = await this.firebase.user(match[1]);
    return true;
  }
}
