import { runtimeCapabilityDefinitions } from './capabilities.js';
import {
  buildChangeContextHandler,
  exploreComponentHandler,
  getProductVersionHandler,
  indexRepoHandler,
  planChangeHandler,
  refreshRepoHandler,
  runHealthChecksHandler,
  serveMcpHandler,
  upgradeProductHandler,
} from './handlers.js';
import type {
  ExecutionContext,
  RuntimeCapabilityDefinition,
  RuntimeCapabilityHandler,
  RuntimeCapabilityName,
  RuntimeCapabilityRequestMap,
  RuntimeCapabilityResponseMap,
  RuntimeDependencies,
  RuntimeHandlerContext,
} from './types.js';

const defaultExecutionContext: ExecutionContext = {
  debug: false,
  outputMode: 'json',
};

type AnyRuntimeHandler = RuntimeCapabilityHandler<any, RuntimeCapabilityResponseMap[RuntimeCapabilityName]>;

export class RuntimeHost {
  private readonly handlers = new Map<RuntimeCapabilityName, AnyRuntimeHandler>();

  public constructor(private readonly dependencies: RuntimeDependencies) {
    this.register(getProductVersionHandler);
    this.register(upgradeProductHandler);
    this.register(indexRepoHandler);
    this.register(refreshRepoHandler);
    this.register(exploreComponentHandler);
    this.register(planChangeHandler);
    this.register(buildChangeContextHandler);
    this.register(runHealthChecksHandler);
    this.register(serveMcpHandler);
  }

  public getCapabilityDefinitions(): RuntimeCapabilityDefinition[] {
    return runtimeCapabilityDefinitions;
  }

  public getDependencyConfig(): RuntimeDependencies['config'] {
    return this.dependencies.config;
  }

  public async execute<TName extends RuntimeCapabilityName>(
    capability: TName,
    request: RuntimeCapabilityRequestMap[TName],
    executionContext: Partial<ExecutionContext> = {},
  ): Promise<RuntimeCapabilityResponseMap[TName]> {
    const handler = this.handlers.get(capability);

    if (!handler) {
      throw new Error(`Runtime capability ${capability} is not implemented.`);
    }

    const handlerContext: RuntimeHandlerContext = {
      executionContext: {
        ...defaultExecutionContext,
        ...executionContext,
      },
      dependencies: this.dependencies,
    };

    return handler.execute(request, handlerContext) as Promise<RuntimeCapabilityResponseMap[TName]>;
  }

  private register(handler: AnyRuntimeHandler): void {
    this.handlers.set(handler.capability, handler);
  }
}
