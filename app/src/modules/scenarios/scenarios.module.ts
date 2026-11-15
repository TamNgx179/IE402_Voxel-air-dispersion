import { Module } from '@nestjs/common';
import {
  ScenariosController,
  ThresholdsController,
} from './controllers/scenarios.controller.js';
import { ScenariosModel } from './models/scenarios.model.js';
import { ScenariosService } from './services/scenarios.service.js';

@Module({
  controllers: [ScenariosController, ThresholdsController],
  providers: [ScenariosModel, ScenariosService],
})
export class ScenariosModule {}
