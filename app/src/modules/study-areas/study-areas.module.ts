import { Module } from '@nestjs/common';
import { StudyAreasController } from './controllers/study-areas.controller.js';
import { StudyAreasModel } from './models/study-areas.model.js';
import { StudyAreasService } from './services/study-areas.service.js';

@Module({
  controllers: [StudyAreasController],
  providers: [StudyAreasModel, StudyAreasService],
})
export class StudyAreasModule {}
