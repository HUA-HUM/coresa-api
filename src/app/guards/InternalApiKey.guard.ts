import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

/**
 * Mismo esquema que internal-api y meli-api: header x-internal-api-key
 * contra CORESA_API_INTERNAL_KEY.
 */
@Injectable()
export class InternalApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(InternalApiKeyGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const expected = String(process.env.CORESA_API_INTERNAL_KEY ?? '').trim();

    if (!expected) {
      this.logger.error(
        'CORESA_API_INTERNAL_KEY no está definida: se rechazan todos los pedidos',
      );
      throw new UnauthorizedException('Internal API key not configured');
    }

    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers['x-internal-api-key'];
    const received = String(
      Array.isArray(header) ? header[0] : (header ?? ''),
    ).trim();

    if (!received) {
      throw new UnauthorizedException('Internal API key missing');
    }
    if (received !== expected) {
      throw new UnauthorizedException('Invalid internal API key');
    }

    return true;
  }
}
