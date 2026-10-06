import { Module } from '@nestjs/common';
import { StudyAreasController } from './study-areas.controller.js';

@Module({
  controllers: [StudyAreasController],
})
export class StudyAreasModule {}
