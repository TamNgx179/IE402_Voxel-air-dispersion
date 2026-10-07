import { Module } from '@nestjs/common';
import { SimulationRunsController } from './controllers/simulation-runs.controller.js';
import { SimulationRunsRepository } from './repositories/simulation-runs.repository.js';
import { SimulationExecutionRepository } from './repositories/simulation-execution.repository.js';
import { SimulationExecutorService } from './services/simulation-executor.service.js';
import { SimulationRunsService } from './services/simulation-runs.service.js';

/** Owns the run state machine and is the only module allowed to spawn Python. */
@Module({
  controllers: [SimulationRunsController],
  providers: [
    SimulationRunsRepository,
    SimulationExecutionRepository,
    SimulationRunsService,
    SimulationExecutorService,
  ],
  exports: [SimulationRunsService],
})
export class SimulationModule {}
