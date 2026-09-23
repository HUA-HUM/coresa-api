import { Injectable } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { APIMeliPublishRepository } from '../../core/drivers/repositories/meli/APIMeliPublishRepository';
import { IMeliPublishRepository } from '../../core/adapters/repositories/IMeliPublishRepository';

@Injectable()
export class NestMeliPublishRepository
  extends APIMeliPublishRepository
  implements IMeliPublishRepository
{
  constructor() {
    const axiosInstance: AxiosInstance = axios.create();
    super(axiosInstance);
  }
}
