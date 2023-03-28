/*
 * Copyright (C) 2018-2022 Garden Technologies, Inc. <info@garden.io>
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { GraphResults } from "../graph/results"
import { v1 as uuidv1 } from "uuid"
import { Garden } from "../garden"
import { ActionLogContext, createActionLog, Log } from "../logger/log-entry"
import { Profile } from "../util/profiling"
import type { Action, ActionState, Executed, Resolved } from "../actions/types"
import { ConfigGraph, GraphError } from "../graph/config-graph"
import type { ActionReference } from "../config/common"
import { InternalError } from "../exceptions"
import type { DeleteDeployTask } from "./delete-deploy"
import type { BuildTask } from "./build"
import type { DeployTask } from "./deploy"
import type { PluginActionTask, PluginTask } from "./plugin"
import type { PublishTask } from "./publish"
import { ResolveActionTask } from "./resolve-action"
import type { ResolveProviderTask } from "./resolve-provider"
import type { RunTask } from "./run"
import type { TestTask } from "./test"
import { Memoize } from "typescript-memoize"
import { getExecuteTaskForAction, getResolveTaskForAction } from "./helpers"

export class TaskDefinitionError extends Error {}

export function makeBaseKey(type: string, name: string) {
  return `${type}.${name}`
}

export interface CommonTaskParams {
  garden: Garden
  log: Log
  force: boolean
  skipDependencies?: boolean
}

export interface BaseActionTaskParams<T extends Action = Action> extends CommonTaskParams {
  log: Log
  action: T
  graph: ConfigGraph
  forceActions?: ActionReference[]
  forceBuild?: boolean // Shorthand for placing all builds in forceActions
  skipRuntimeDependencies?: boolean
  startSyncs?: boolean
}

export interface TaskProcessParams {
  statusOnly: boolean
  dependencyResults: GraphResults
}

export interface ValidResultType {
  state: ActionState
  outputs: {}
}

export type Task =
  | BuildTask
  | DeleteDeployTask
  | DeployTask
  | PluginTask
  | PluginActionTask<any, any>
  | PublishTask
  | ResolveActionTask<any>
  | ResolveProviderTask
  | RunTask
  | TestTask

export type ExecuteTask = BuildTask | DeployTask | RunTask | TestTask

export interface ResolveProcessDependenciesParams<S extends ValidResultType> {
  status: S | null
}

export interface BaseTaskOutputs {
  version: string
}

@Profile()
export abstract class BaseTask<O extends ValidResultType = ValidResultType> {
  abstract type: string

  // How many tasks of this exact type are allowed to run concurrently
  concurrencyLimit = 10

  public readonly garden: Garden
  public readonly log: Log
  public readonly uid: string
  public readonly force: boolean
  public readonly skipDependencies: boolean
  protected readonly executeTask: boolean = false
  interactive = false

  _resultType: O & BaseTaskOutputs
  _resolvedDependencies?: BaseTask[]

  constructor(initArgs: CommonTaskParams) {
    this.garden = initArgs.garden
    this.uid = uuidv1() // uuidv1 is timestamp-based
    this.force = !!initArgs.force
    this.log = initArgs.log
    this.skipDependencies = !!initArgs.skipDependencies
  }

  abstract getName(): string

  // Which dependencies must be resolved to call this task's getStatus method
  abstract resolveStatusDependencies(): BaseTask[]
  // Which dependencies must be resolved to call this task's process method, in addition to the above
  abstract resolveProcessDependencies(params: ResolveProcessDependenciesParams<O>): BaseTask[]

  abstract getDescription(): string
  abstract getStatus(params: TaskProcessParams): Promise<O | null>
  abstract process(params: TaskProcessParams): Promise<O>

  /**
   * The "input version" of a task generally refers to the version of the task's inputs, before
   * any resolution or execution happens. For action tasks, this will generally be the unresolved
   * version.
   *
   * The corresponding "output version" is what's returned by the `getStatus` and `process` handlers.
   */
  abstract getInputVersion(): string

  /**
   * Wrapper around resolveStatusDependencies() that memoizes the results.
   */
  @Memoize()
  getStatusDependencies(): BaseTask[] {
    return this.resolveStatusDependencies()
  }

  /**
   * Wrapper around resolveProcessDependencies() that memoizes the results and applies filters.
   */
  @Memoize()
  getProcessDependencies(params: ResolveProcessDependenciesParams<O>): BaseTask[] {
    if (this.skipDependencies) {
      return []
    }
    return this.resolveProcessDependencies(params)
  }

  /**
   * The basic type and name of the task.
   */
  getBaseKey(): string {
    return makeBaseKey(this.type, this.getName())
  }

  /**
   * A key that factors in different parameters, e.g. sync mode for deploys, force flags, versioning etc.
   * Used to handle overlapping graph solve requests.
   */
  getKey(): string {
    // TODO-G2
    let key = this.getBaseKey()

    // if (this.force) {
    //   key += ".force=true"
    // }

    return key
  }

  /**
   * A completely unique key for the instance of the task.
   */
  getId(): string {
    return `${this.getBaseKey()}.${this.uid}`
  }

  isExecuteTask(): this is ExecuteTask {
    return this.executeTask
  }
}

export interface ActionTaskStatusParams<_ extends Action> extends TaskProcessParams {}
export interface ActionTaskProcessParams<T extends Action, S extends ValidResultType>
  extends ActionTaskStatusParams<T> {
  status: S
}

export interface BaseActionTaskOutputs extends BaseTaskOutputs {}

export abstract class BaseActionTask<T extends Action, O extends ValidResultType> extends BaseTask<O> {
  _resultType: O & BaseActionTaskOutputs

  action: T
  graph: ConfigGraph
  forceActions: ActionReference[]
  skipRuntimeDependencies: boolean
  startSyncs: boolean
  log: Log<ActionLogContext>

  constructor(params: BaseActionTaskParams<T>) {
    const { action } = params
    super({ ...params })
    this.log = createActionLog({ log: params.log, actionName: action.name, actionKind: action.kind })
    this.action = action
    this.graph = params.graph
    this.forceActions = params.forceActions || []
    this.skipRuntimeDependencies = params.skipRuntimeDependencies || false
    this.startSyncs = params.startSyncs || false

    if (params.forceBuild) {
      this.forceActions.push(...this.graph.getBuilds())
    }
  }

  abstract getStatus(params: ActionTaskStatusParams<T>): Promise<O | null>
  abstract process(params: ActionTaskProcessParams<T, O>): Promise<O>

  getName() {
    return this.action.name
  }

  getInputVersion(): string {
    return this.action.versionString()
  }

  // Most tasks can just use these default methods.
  resolveStatusDependencies(): BaseTask[] {
    return [this.getResolveTask(this.action)]
  }

  resolveProcessDependencies({ status }: ResolveProcessDependenciesParams<ValidResultType>): BaseTask[] {
    const resolveTask = this.getResolveTask(this.action)

    if (status?.state === "ready" && !this.force) {
      return [resolveTask]
    }

    const deps = this.action.getDependencyReferences().flatMap((dep): BaseTask[] => {
      const action = this.graph.getActionByRef(dep, { includeDisabled: true })
      const disabled = action.isDisabled()

      // Maybe we can make this easier to reason about... - JE
      if (dep.needsExecutedOutputs) {
        if (disabled && action.kind !== "Build") {
          // TODO-G2: Need to handle conditional references, over in dependenciesFromAction()
          throw new GraphError(
            `${this.action.longDescription()} depends on one or more runtime outputs from action ${
              action.key
            }, which is disabled. Please either remove the reference or enable the action.`,
            { dependant: this.action.key(), dependency: action.key() }
          )
        }
        return [this.getExecuteTask(action)]
      } else if (dep.explicit) {
        if (this.skipRuntimeDependencies && dep.kind !== "Build") {
          if (dep.needsStaticOutputs) {
            return [this.getResolveTask(action)]
          } else {
            return []
          }
        } else {
          return [this.getExecuteTask(action)]
        }
      } else if (dep.needsStaticOutputs) {
        return [this.getResolveTask(action)]
      } else {
        return []
      }
    })

    return [resolveTask, ...deps]
  }

  // Helpers //

  protected getBaseDependencyParams() {
    return {
      garden: this.garden,
      log: this.log,
      graph: this.graph,
      forceActions: this.forceActions,
      skipDependencies: this.skipDependencies,
      skipRuntimeDependencies: this.skipRuntimeDependencies,
      startSyncs: this.startSyncs,
    }
  }

  /**
   * Given a set of graph results, return a resolved version of the action.
   * Throws if the dependency results don't contain the required task results.
   */
  getResolvedAction(action: Action, dependencyResults: GraphResults): Resolved<T> {
    const resolveTask = this.getResolveTask(action)
    const result = dependencyResults.getResult(resolveTask)

    if (!result) {
      throw new InternalError(
        `Could not find resolved action '${action.key()}' when processing task '${this.getBaseKey()}'.`,
        { taskType: this.type, action: action.key() }
      )
    }

    return <Resolved<T>>result.outputs.resolvedAction
  }

  /**
   * Given a set of graph results, return an executed version of the action.
   * Throws if the dependency results don't contain the required task results.
   */
  getExecutedAction(action: Action, dependencyResults: GraphResults): Executed<T> {
    const execTask = this.getExecuteTask(action)
    const result = dependencyResults.getResult(execTask)

    if (!result) {
      throw new InternalError(
        `Could not find executed action '${action.key()}' when processing task '${this.getBaseKey()}'.`,
        { taskType: this.type, action: action.key() }
      )
    }

    return <Executed<T>>result.result?.executedAction
  }

  /**
   * Returns the ResolveActionTask for the given Action.
   */
  protected getResolveTask(action: Action) {
    const force = !!this.forceActions.find((r) => r.kind === action.kind && r.name === action.name)
    return getResolveTaskForAction(action, { ...this.getBaseDependencyParams(), force })
  }

  /**
   * Returns the execution Task for the given Action, e.g. DeployTask for Deploy, BuildTask for Build etc.
   *
   * Note that this is not always the correct Task to perform when processing deps, e.g. for the DeleteDeployTask.
   */
  protected getExecuteTask(action: Action) {
    const force = !!this.forceActions.find((r) => r.kind === action.kind && r.name === action.name)
    return getExecuteTaskForAction(action, { ...this.getBaseDependencyParams(), force })
  }
}

export interface ExecuteActionOutputs<T extends Action> extends BaseActionTaskOutputs {
  executedAction: Executed<T>
}

export abstract class ExecuteActionTask<
  T extends Action,
  O extends ValidResultType = { state: ActionState; outputs: T["_outputs"]; detail: any }
> extends BaseActionTask<T, O> {
  _resultType: O & ExecuteActionOutputs<T>
  executeTask = true

  abstract getStatus(params: ActionTaskStatusParams<T>): Promise<(O & ExecuteActionOutputs<T>) | null>
  abstract process(params: ActionTaskProcessParams<T, O>): Promise<O & ExecuteActionOutputs<T>>
}
