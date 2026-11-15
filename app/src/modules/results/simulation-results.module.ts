import { Module } from '@nestjs/common';
import { TransectController } from './controllers/transect.controller.js';
import { TransectService } from './services/transect.service.js';
import { TransectModel } from './models/transect.model.js';
import { SimulationResultsController } from './controllers/simulation-results.controller.js';
import { SimulationResultsModel } from './models/simulation-results.model.js';
import { SimulationResultsService } from './services/simulation-results.service.js';
import { SpatialAnalysisController } from './controllers/spatial-analysis.controller.js';
import { SpatialAnalysisModel } from './models/spatial-analysis.model.js';
import { SpatialAnalysisService } from './services/spatial-analysis.service.js';

@Module({
  controllers: [
    SimulationResultsController,
    SpatialAnalysisController,
    TransectController,
  ],
  providers: [
    TransectService,
    TransectModel,
    SimulationResultsModel,
    SimulationResultsService,
    SpatialAnalysisModel,
    SpatialAnalysisService,
  ],
  exports: [SimulationResultsService],
})
export class SimulationResultsModule {}
