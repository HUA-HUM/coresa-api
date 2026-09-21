import { Injectable } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { IExchangeRateRepository } from '../../core/adapters/repositories/IExchangeRateRepository';
import { APIBluelyticsExchangeRateRepository } from '../../core/drivers/repositories/exchange/APIBluelyticsExchangeRateRepository';

@Injectable()
export class NestExchangeRateRepository
  extends APIBluelyticsExchangeRateRepository
  implements IExchangeRateRepository
{
  constructor() {
    const axiosInstance: AxiosInstance = axios.create();
    super(axiosInstance);
  }
}
