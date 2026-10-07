import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CreateRunDto } from './dto/create-run.dto.js';
import { ListRunsQueryDto } from './dto/list-runs-query.dto.js';
import { type RunAccepted, RunsService, type RunView } from './runs.service.js';

/**
 * Run lifecycle (BR-16..BR-21). POST /runs validates the DTO, snapshots the
 * parameters and returns 202 + run_id; the internal executor
 * (SimulationExecutor) is the only code that spawns the Python solver.
 */
@ApiTags('runs')
@Controller('runs')
export class SimulationController {
  constructor(private readonly runs: RunsService) {}

  @Get()
  @ApiOperation({ summary: 'List recent runs for the web viewer' })
  @ApiOkResponse({ description: 'Recent runs, newest first' })
  list(@Query() query: ListRunsQueryDto) {
    return this.runs.list(query);
  }

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Create an asynchronous run (status queued)' })
  @ApiAcceptedResponse({ description: '{ run_id, status: "queued", attempt }' })
  @ApiBadRequestResponse({ description: 'Invalid body; no run is created' })
  @ApiNotFoundResponse({
    description: 'Unknown scenario_id; no run is created',
  })
  create(@Body() body: CreateRunDto): Promise<RunAccepted> {
    return this.runs.create(body);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Run status, progress, error, metrics and verification checks',
  })
  @ApiOkResponse({ description: 'Run view' })
  @ApiBadRequestResponse({ description: 'id is not a UUID' })
  @ApiNotFoundResponse({ description: 'No such run' })
  get(@Param('id', new ParseUUIDPipe()) id: string): Promise<RunView> {
    return this.runs.get(id);
  }

  @Post(':id/retry')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Re-queue a failed or stale run (attempt + 1)' })
  @ApiAcceptedResponse({ description: '{ run_id, status: "queued", attempt }' })
  @ApiNotFoundResponse({ description: 'No such run' })
  @ApiConflictResponse({ description: 'Run is queued, running or succeeded' })
  retry(@Param('id', new ParseUUIDPipe()) id: string): Promise<RunAccepted> {
    return this.runs.retry(id);
  }
}
