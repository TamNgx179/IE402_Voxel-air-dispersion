import { Module } from '@nestjs/common';
import {
  ScenariosController,
  ThresholdsController,
} from './controllers/scenarios.controller.js';
import { ScenariosRepository } from './repositories/scenarios.repository.js';
import { ScenariosService } from './services/scenarios.service.js';

@Module({
  controllers: [ScenariosController, ThresholdsController],
  providers: [ScenariosRepository, ScenariosService],
})
export class ScenariosModule {}
