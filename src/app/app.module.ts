import { join } from 'path';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { HealthController } from './controller/Health.controller';
import { ProductsCoresaController } from './controller/coresa/Products.controller';
import { PublicationsCoresaController } from './controller/coresa/Publications.controller';
import { NestCoresaPublicationRepository } from './drivers/NestCoresaPublicationRepository';
import { NestCoresaRepository } from './drivers/NestCoresaRepository';
import { NestExchangeRateRepository } from './drivers/NestExchangeRateRepository';
import { NestInternalApiRepository } from './drivers/NestInternalApiRepository';
import { NestMeliApiRepository } from './drivers/NestMeliApiRepository';
import { NestMeliPublishRepository } from './drivers/NestMeliPublishRepository';
import { NestProductEnrichmentRepository } from './drivers/NestProductEnrichmentRepository';
import { SyncCoresaCatalogProcess } from './processes/SyncCoresaCatalog.process';
import { ICoresaPublicationRepositoryToken } from '../core/adapters/repositories/ICoresaPublicationRepository';
import { ICoresaRepositoryToken } from '../core/adapters/repositories/ICoresaRepository';
import { IExchangeRateRepositoryToken } from '../core/adapters/repositories/IExchangeRateRepository';
import { IInternalApiRepositoryToken } from '../core/adapters/repositories/IInternalApiRepository';
import { IMeliPublishRepositoryToken } from '../core/adapters/repositories/IMeliPublishRepository';
import { IMercadoLibreRepositoryToken } from '../core/adapters/repositories/IMercadoLibreRepository';
import { IProductEnrichmentRepositoryToken } from '../core/adapters/repositories/IProductEnrichmentRepository';
import { PreviewCoresaPublication } from '../core/interactors/coresa/PreviewCoresaPublication';
import { PublishCoresaPublication } from '../core/interactors/coresa/PublishCoresaPublication';
import { QueryCoresaPublications } from '../core/interactors/coresa/QueryCoresaPublications';
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
  controllers: [
    HealthController,
    ProductsCoresaController,
    PublicationsCoresaController,
  ],
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
    {
      provide: IExchangeRateRepositoryToken,
      useClass: NestExchangeRateRepository,
    },
    {
      provide: IMeliPublishRepositoryToken,
      useClass: NestMeliPublishRepository,
    },
    {
      provide: IProductEnrichmentRepositoryToken,
      useClass: NestProductEnrichmentRepository,
    },
    {
      provide: ICoresaPublicationRepositoryToken,
      useClass: NestCoresaPublicationRepository,
    },
    SyncCoresaCatalog,
    SyncCoresaProductsToInternalApi,
    SyncCoresaCatalogProcess,
    PreviewCoresaPublication,
    PublishCoresaPublication,
    QueryCoresaPublications,
  ],
})
export class AppModule {}
