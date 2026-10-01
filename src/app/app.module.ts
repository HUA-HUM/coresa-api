import { join } from 'path';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { HealthController } from './controller/Health.controller';
import { ProductsCoresaController } from './controller/coresa/Products.controller';
import { ModalidadesCoresaController } from './controller/coresa/Modalidades.controller';
import { PublicationsCoresaController } from './controller/coresa/Publications.controller';
import { SkusCoresaController } from './controller/coresa/Skus.controller';
import { NestCdnImagesRepository } from './drivers/NestCdnImagesRepository';
import { NestCoresaPublicationRepository } from './drivers/NestCoresaPublicationRepository';
import { NestCoresaRepository } from './drivers/NestCoresaRepository';
import { NestExchangeRateRepository } from './drivers/NestExchangeRateRepository';
import { NestInternalApiRepository } from './drivers/NestInternalApiRepository';
import { NestMeliApiRepository } from './drivers/NestMeliApiRepository';
import { NestMeliPublishRepository } from './drivers/NestMeliPublishRepository';
import { NestProductEnrichmentRepository } from './drivers/NestProductEnrichmentRepository';
import { SyncCoresaCatalogProcess } from './processes/SyncCoresaCatalog.process';
import { SyncCoresaProductsToMercadoLibreProcess } from './processes/SyncCoresaProductsToMercadoLibre.process';
import { ICoresaPublicationRepositoryToken } from '../core/adapters/repositories/ICoresaPublicationRepository';
import { ICoresaRepositoryToken } from '../core/adapters/repositories/ICoresaRepository';
import { IExchangeRateRepositoryToken } from '../core/adapters/repositories/IExchangeRateRepository';
import { IInternalApiRepositoryToken } from '../core/adapters/repositories/IInternalApiRepository';
import { IMeliPublishRepositoryToken } from '../core/adapters/repositories/IMeliPublishRepository';
import { IMercadoLibreRepositoryToken } from '../core/adapters/repositories/IMercadoLibreRepository';
import { IProductEnrichmentRepositoryToken } from '../core/adapters/repositories/IProductEnrichmentRepository';
import { IProductImageRepositoryToken } from '../core/adapters/repositories/IProductImageRepository';
import { FinancingCosts } from '../core/interactors/coresa/FinancingCosts';
import { GetCoresaSkuInfo } from '../core/interactors/coresa/GetCoresaSkuInfo';
import { PreviewCoresaPublication } from '../core/interactors/coresa/PreviewCoresaPublication';
import { PublishCoresaPublication } from '../core/interactors/coresa/PublishCoresaPublication';
import { QueryCoresaPublications } from '../core/interactors/coresa/QueryCoresaPublications';
import { UpdateCoresaPublicationDraft } from '../core/interactors/coresa/UpdateCoresaPublicationDraft';
import { SyncCoresaCatalog } from '../core/interactors/coresa/SyncCoresaCatalog';
import { SyncCoresaProductsToMercadoLibreApi } from '../core/interactors/coresa/SyncCoresaProductsToMercadoLibreApi';

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
    ModalidadesCoresaController,
    PublicationsCoresaController,
    SkusCoresaController,
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
      provide: IProductImageRepositoryToken,
      useClass: NestCdnImagesRepository,
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
    SyncCoresaProductsToMercadoLibreApi,
    SyncCoresaCatalogProcess,
    SyncCoresaProductsToMercadoLibreProcess,
    FinancingCosts,
    GetCoresaSkuInfo,
    PreviewCoresaPublication,
    PublishCoresaPublication,
    QueryCoresaPublications,
    UpdateCoresaPublicationDraft,
  ],
})
export class AppModule {}
