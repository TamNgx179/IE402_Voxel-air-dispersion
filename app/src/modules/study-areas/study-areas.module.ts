import { Module } from '@nestjs/common';
import { StudyAreasController } from './study-areas.controller.js';
import { StudyAreasService } from './study-areas.service.js';

@Module({
  controllers: [StudyAreasController],
  providers: [StudyAreasService],
})
export class StudyAreasModule {}
