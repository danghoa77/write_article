import { Module } from '@nestjs/common';

import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { BrowserSessionService } from './browser-session.service.js';
import { BrowserSessionGuard } from './browser-session.guard.js';
import { BrowserAuthController } from './browser-auth.controller.js';

@Module({
  controllers: [AuthController, BrowserAuthController],
  providers: [AuthService, BrowserSessionService, BrowserSessionGuard],
  exports: [AuthService, BrowserSessionService, BrowserSessionGuard],
})
export class AuthModule {}
