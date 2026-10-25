import { Module } from '@nestjs/common';
import { FirebaseService } from './firebase.service.js';
import { FirebaseIdentityGuard } from './firebase-identity.guard.js';

@Module({
  providers: [FirebaseService, FirebaseIdentityGuard],
  exports: [FirebaseService, FirebaseIdentityGuard],
})
export class FirebaseModule {}
