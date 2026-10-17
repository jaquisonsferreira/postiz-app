import { Global, Injectable, Logger, Module, OnModuleInit } from '@nestjs/common';
import { WorkflowExecutionAlreadyStartedError } from '@temporalio/common';
import { TemporalService } from 'nestjs-temporal-core';

@Injectable()
export class InfiniteWorkflowRegister implements OnModuleInit {
  constructor(private _temporalService: TemporalService) {}

  async onModuleInit(): Promise<void> {
    if (!!process.env.RUN_CRON) {
      try {
        await this._temporalService.client
          ?.getRawClient()
          ?.workflow?.start('missingPostWorkflow', {
            workflowId: 'missing-post-workflow',
            taskQueue: 'main',
          });
      } catch (err) {}
      try {
        await this._temporalService.client
          ?.getRawClient()
          ?.workflow?.start('adsSyncWorkflow', {
            workflowId: 'ads-sync-workflow',
            taskQueue: 'main',
          });
      } catch (err) {
        if (!(err instanceof WorkflowExecutionAlreadyStartedError)) {
          Logger.error(`Could not start the ads sync: ${err}`);
        }
      }
    }
  }
}

@Global()
@Module({
  imports: [],
  controllers: [],
  providers: [InfiniteWorkflowRegister],
  get exports() {
    return this.providers;
  },
})
export class InfiniteWorkflowRegisterModule {}
