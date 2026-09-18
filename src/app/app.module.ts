import { join } from 'path';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { HealthController } from './controller/Health.controller';
import { ProductsCoresaController } from './controller/coresa/Products.controller';
import { NestCoresaRepository } from './drivers/NestCoresaRepository';
import { NestInternalApiRepository } from './drivers/NestInternalApiRepository';
import { NestMeliApiRepository } from './drivers/NestMeliApiRepository';
import { SyncCoresaCatalogProcess } from './processes/SyncCoresaCatalog.process';
import { ICoresaRepositoryToken } from '../core/adapters/repositories/ICoresaRepository';
import { IInternalApiRepositoryToken } from '../core/adapters/repositories/IInternalApiRepository';
import { IMercadoLibreRepositoryToken } from '../core/adapters/repositories/IMercadoLibreRepository';
import { SyncCoresaCatalog } from '../core/interactors/coresa/SyncCoresaCatalog';
import { SyncCoresaProductsToInternalApi } from '../core/interactors/coresa/SyncCoresaProductsToInternalApi';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: join(process.cwd(), '.env'),
    }),
    ScheduleModule.forRoot(),
  ],
  controllers: [HealthController, ProductsCoresaController],
  providers: [
    {
      provide: ICoresaRepositoryToken,
      useClass: NestCoresaRepository,
    },
    {
      provide: IInternalApiRepositoryToken,
      useClass: NestInternalApiRepository,
    },
    {
      provide: IMercadoLibreRepositoryToken,
      useClass: NestMeliApiRepository,
    },
    SyncCoresaCatalog,
    SyncCoresaProductsToInternalApi,
    SyncCoresaCatalogProcess,
  ],
})
export class AppModule {}
