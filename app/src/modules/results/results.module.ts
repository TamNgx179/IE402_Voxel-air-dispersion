import { Module } from '@nestjs/common';
import { ResultsController } from './results.controller.js';

@Module({
  controllers: [ResultsController],
})
export class ResultsModule {}
