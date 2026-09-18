import { Injectable } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { APIMeliApiRepository } from '../../core/drivers/repositories/meli/APIMeliApiRepository';
import { IMercadoLibreRepository } from '../../core/adapters/repositories/IMercadoLibreRepository';

@Injectable()
export class NestMeliApiRepository
  extends APIMeliApiRepository
  implements IMercadoLibreRepository
{
  constructor() {
    const axiosInstance: AxiosInstance = axios.create();
    super(axiosInstance);
  }
}
