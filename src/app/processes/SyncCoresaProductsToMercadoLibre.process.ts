import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SyncCoresaProductsToMercadoLibreApi } from '../../core/interactors/coresa/SyncCoresaProductsToMercadoLibreApi';

@Injectable()
export class SyncCoresaProductsToMercadoLibreProcess {
  private readonly logger = new Logger(
    SyncCoresaProductsToMercadoLibreProcess.name,
  );

  constructor(
    private readonly syncCoresaProductsToMercadoLibre: SyncCoresaProductsToMercadoLibreApi,
  ) {}

  @Cron('15 * * * *')
  async handleCron() {
    this.logger.log('Cron ejecutando sync de productos Coresa a Mercado Libre');
    await this.syncCoresaProductsToMercadoLibre.execute();
  }
}
