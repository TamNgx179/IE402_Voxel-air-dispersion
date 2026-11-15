import { Module } from '@nestjs/common';
import { SimulationRunsController } from './controllers/simulation-runs.controller.js';
import { SimulationRunsModel } from './models/simulation-runs.model.js';
import { SimulationExecutionModel } from './models/simulation-execution.model.js';
import { SimulationExecutorService } from './services/simulation-executor.service.js';
import { SimulationRunsService } from './services/simulation-runs.service.js';

/** Owns the run state machine and is the only module allowed to spawn Python. */
@Module({
  controllers: [SimulationRunsController],
  providers: [
    SimulationRunsModel,
    SimulationExecutionModel,
    SimulationRunsService,
    SimulationExecutorService,
  ],
  exports: [SimulationRunsService],
})
export class SimulationModule {}
