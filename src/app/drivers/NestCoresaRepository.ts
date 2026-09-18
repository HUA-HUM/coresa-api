import { Injectable } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { APICoresaRepository } from '../../core/drivers/repositories/coresa/APICoresaRepository';
import { ICoresaRepository } from '../../core/adapters/repositories/ICoresaRepository';

@Injectable()
export class NestCoresaRepository
  extends APICoresaRepository
  implements ICoresaRepository
{
  constructor() {
    const axiosInstance: AxiosInstance = axios.create();
    super(axiosInstance);
  }
}
