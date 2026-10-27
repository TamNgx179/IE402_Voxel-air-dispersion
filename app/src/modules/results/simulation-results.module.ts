import { Module } from '@nestjs/common';
import { TransectController } from './controllers/transect.controller.js';
import { TransectService } from './services/transect.service.js';
import { TransectRepository } from './repositories/transect.repository.js';
import { SimulationResultsController } from './controllers/simulation-results.controller.js';
import { SimulationResultsRepository } from './repositories/simulation-results.repository.js';
import { SimulationResultsService } from './services/simulation-results.service.js';
import { SpatialAnalysisController } from './controllers/spatial-analysis.controller.js';
import { SpatialAnalysisRepository } from './repositories/spatial-analysis.repository.js';
import { SpatialAnalysisService } from './services/spatial-analysis.service.js';

@Module({
  controllers: [
    SimulationResultsController,
    SpatialAnalysisController,
    TransectController,
  ],
  providers: [
    TransectService,
    TransectRepository,
    SimulationResultsRepository,
    SimulationResultsService,
    SpatialAnalysisRepository,
    SpatialAnalysisService,
  ],
  exports: [SimulationResultsService],
})
export class SimulationResultsModule {}
