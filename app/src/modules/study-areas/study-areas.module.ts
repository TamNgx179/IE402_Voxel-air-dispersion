import { Module } from '@nestjs/common';
import { StudyAreasController } from './controllers/study-areas.controller.js';
import { StudyAreasRepository } from './repositories/study-areas.repository.js';
import { StudyAreasService } from './services/study-areas.service.js';

@Module({
  controllers: [StudyAreasController],
  providers: [StudyAreasRepository, StudyAreasService],
})
export class StudyAreasModule {}
