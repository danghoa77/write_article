import { Body, Controller, Delete, Param, Post } from '@nestjs/common';
import { AuthService } from './auth.service.js';

@Controller('auth')
export class AuthController {
    constructor(private readonly authService: AuthService) { }

    @Post('login')
    async login(
        @Body('username') username: string,
        @Body('password') password: string,
    ) {
        return this.authService.login(username, password);
    }

    @Delete('delete')
    async delete(
        @Param('token') token: string
    ) {

        return this.authService.deleteToken(token)
    }
}
