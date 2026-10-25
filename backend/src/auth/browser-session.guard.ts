import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { BrowserSessionService } from './browser-session.service.js';

@Injectable()
export class BrowserSessionGuard implements CanActivate {
  constructor(private readonly sessions: BrowserSessionService) {}
  canActivate(context: ExecutionContext) {
    const http = context.switchToHttp();
    const request = http.getRequest();
    const response = http.getResponse();
    response.setHeader('Cache-Control', 'no-store');
    try {
      request.browserSession = this.sessions.read(request);
    } catch (error) {
      this.sessions.clear(request, response);
      throw error;
    }
    return true;
  }
}
