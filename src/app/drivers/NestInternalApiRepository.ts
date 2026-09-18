import { Injectable } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { APIInternalApiRepository } from '../../core/drivers/repositories/internal/APIInternalApiRepository';
import { IInternalApiRepository } from '../../core/adapters/repositories/IInternalApiRepository';

@Injectable()
export class NestInternalApiRepository
  extends APIInternalApiRepository
  implements IInternalApiRepository
{
  constructor() {
    const axiosInstance: AxiosInstance = axios.create();
    super(axiosInstance);
  }
}
