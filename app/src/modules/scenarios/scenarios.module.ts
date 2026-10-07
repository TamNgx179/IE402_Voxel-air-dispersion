import { Module } from '@nestjs/common';
import {
  ScenariosController,
  ThresholdsController,
} from './scenarios.controller.js';
import { ScenariosService } from './scenarios.service.js';

@Module({
  controllers: [ScenariosController, ThresholdsController],
  providers: [ScenariosService],
})
export class ScenariosModule {}
