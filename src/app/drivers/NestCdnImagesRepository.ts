import { Injectable } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { APICdnImagesRepository } from '../../core/drivers/repositories/images/APICdnImagesRepository';
import { IProductImageRepository } from '../../core/adapters/repositories/IProductImageRepository';

@Injectable()
export class NestCdnImagesRepository
  extends APICdnImagesRepository
  implements IProductImageRepository
{
  constructor() {
    const axiosInstance: AxiosInstance = axios.create();
    super(axiosInstance);
  }
}
