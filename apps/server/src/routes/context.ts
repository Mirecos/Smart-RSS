import type { AppConfig } from '../config.js';
import type { PipelineDeps } from '../pipeline/run.js';
import type { Repositories } from '../repositories/index.js';
import type { Scheduler } from '../scheduler/scheduler.js';

export interface RouteContext {
  config: AppConfig;
  repos: Repositories;
  scheduler: Scheduler;
  pipeline: PipelineDeps;
  now: () => Date;
}
