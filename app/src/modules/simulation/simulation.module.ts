import { Module } from '@nestjs/common';
import { SimulationExecutor } from './executor.service.js';
import { RunsService } from './runs.service.js';
import { SimulationController } from './simulation.controller.js';

/** Owns the run state machine and is the only module allowed to spawn Python. */
@Module({
  controllers: [SimulationController],
  providers: [RunsService, SimulationExecutor],
  exports: [RunsService],
})
export class SimulationModule {}
