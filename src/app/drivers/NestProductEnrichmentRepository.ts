import { Injectable } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { APIOpenAIProductEnrichmentRepository } from '../../core/drivers/repositories/openai/APIOpenAIProductEnrichmentRepository';
import { IProductEnrichmentRepository } from '../../core/adapters/repositories/IProductEnrichmentRepository';

@Injectable()
export class NestProductEnrichmentRepository
  extends APIOpenAIProductEnrichmentRepository
  implements IProductEnrichmentRepository
{
  constructor() {
    const axiosInstance: AxiosInstance = axios.create();
    super(axiosInstance);
  }
}
