import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SyncCoresaCatalog } from '../../core/interactors/coresa/SyncCoresaCatalog';

@Injectable()
export class SyncCoresaCatalogProcess {
  private readonly logger = new Logger(SyncCoresaCatalogProcess.name);

  constructor(private readonly syncCoresaCatalog: SyncCoresaCatalog) {}

  @Cron('0 */2 * * *')
  async handleCron() {
    this.logger.log('Cron ejecutando sync de catálogo Coresa');
    await this.syncCoresaCatalog.execute();
  }
}
