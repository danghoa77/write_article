import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  BrowserSessionService,
  type BrowserSession,
} from './browser-session.service.js';
import { BrowserSessionGuard } from './browser-session.guard.js';

@Controller('auth/browser')
export class BrowserAuthController {
  constructor(private readonly sessions: BrowserSessionService) {}
  @Post('login')
  login(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body() body: { username: string; password: string; remember?: boolean },
  ) {
    return this.sessions.login(request, response, body);
  }
  @Get('session')
  @UseGuards(BrowserSessionGuard)
  session(@Req() request: Request & { browserSession: BrowserSession }) {
    return this.sessions.identity(request.browserSession);
  }
  @Post('logout')
  logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.sessions.clear(request, response);
    response.setHeader('Cache-Control', 'no-store');
    return { success: true };
  }
}
