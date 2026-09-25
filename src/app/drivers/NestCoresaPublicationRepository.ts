import { Injectable } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { APICoresaPublicationRepository } from '../../core/drivers/repositories/internal/APICoresaPublicationRepository';
import { ICoresaPublicationRepository } from '../../core/adapters/repositories/ICoresaPublicationRepository';

@Injectable()
export class NestCoresaPublicationRepository
  extends APICoresaPublicationRepository
  implements ICoresaPublicationRepository
{
  constructor() {
    const axiosInstance: AxiosInstance = axios.create();
    super(axiosInstance);
  }
}
