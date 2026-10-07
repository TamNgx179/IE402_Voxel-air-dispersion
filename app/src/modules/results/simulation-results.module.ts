import { Module } from '@nestjs/common';
import { SimulationResultsController } from './controllers/simulation-results.controller.js';
import { SimulationResultsRepository } from './repositories/simulation-results.repository.js';
import { SimulationResultsService } from './services/simulation-results.service.js';

@Module({
  controllers: [SimulationResultsController],
  providers: [SimulationResultsRepository, SimulationResultsService],
  exports: [SimulationResultsService],
})
export class SimulationResultsModule {}
