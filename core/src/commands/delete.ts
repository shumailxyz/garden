/*
 * Copyright (C) 2018-2023 Garden Technologies, Inc. <info@garden.io>
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { Command, CommandGroup, CommandParams, CommandResult } from "./base"
import dedent from "dedent"
import { printHeader } from "../logger/util"
import { EnvironmentStatusMap } from "../plugin/handlers/Provider/getEnvironmentStatus"
import { DeleteDeployTask, deletedDeployStatuses } from "../tasks/delete-deploy"
import { joi, joiIdentifierMap } from "../config/common"
import { environmentStatusSchema } from "../config/status"
import { BooleanParameter, StringsParameter } from "../cli/params"
import { deline } from "../util/string"
import { uniqByName } from "../util/util"
import { isDeployAction } from "../actions/deploy"
import { omit, mapValues } from "lodash"
import { DeployStatus, DeployStatusMap, getDeployStatusSchema } from "../plugin/handlers/Deploy/get-status"
import chalk from "chalk"

// TODO: rename this to CleanupCommand, and do the same for all related classes, constants, variables and functions
export class DeleteCommand extends CommandGroup {
  name = "cleanup"
  aliases = ["del", "delete"]
  help = "Clean up resources."

  subCommands = [DeleteEnvironmentCommand, DeleteDeployCommand]
}

const dependantsFirstOpt = {
  "dependants-first": new BooleanParameter({
    help: dedent`
      Clean up Deploy(s) (or services if using modules) in reverse dependency order. That is, if service-a has a dependency on service-b, service-a will be deleted before service-b when calling \`garden cleanup namespace service-a,service-b --dependants-first\`.

      When this flag is not used, all services in the project are cleaned up simultaneously.
    `,
  }),
}

const deleteEnvironmentOpts = dependantsFirstOpt

type DeleteEnvironmentOpts = typeof dependantsFirstOpt

interface DeleteEnvironmentResult {
  providerStatuses: EnvironmentStatusMap
  deployStatuses: {
    [name: string]: DeployStatus
  }
}

export class DeleteEnvironmentCommand extends Command<{}, DeleteEnvironmentOpts> {
  name = "namespace"
  aliases = ["environment", "env", "ns"]
  help = "Deletes a running namespace."

  protected = true
  streamEvents = true

  options = deleteEnvironmentOpts

  description = dedent`
    This will clean up everything deployed in the specified environment, and trigger providers to clear up any other resources
    and reset it. When you then run \`garden deploy\` after, the namespace will be reconfigured.

    This can be useful if you find the namespace to be in an inconsistent state, or need/want to free up resources.
  `

  outputsSchema = () =>
    joi.object().keys({
      providerStatuses: joiIdentifierMap(environmentStatusSchema()).description(
        "The status of each provider in the namespace."
      ),
      deployStatuses: joiIdentifierMap(getDeployStatusSchema()).description(
        "The status of each deployment in the namespace."
      ),
    })

  printHeader({ log }) {
    printHeader(log, `Cleanup namespace`, "♻️")
  }

  async action({
    garden,
    log,
    opts,
  }: CommandParams<{}, DeleteEnvironmentOpts>): Promise<CommandResult<DeleteEnvironmentResult>> {
    const actions = await garden.getActionRouter()
    const graph = await garden.getConfigGraph({ log, emit: true })
    const deployStatuses = await actions.deleteDeploys({
      graph,
      log,
      dependantsFirst: opts["dependants-first"],
    })

    log.info("")

    const providerStatuses = await actions.provider.cleanupAll(log)

    log.info(chalk.green("\nDone!"))

    return {
      result: {
        deployStatuses: <DeployStatusMap>mapValues(deployStatuses, (s) => omit(s, ["version", "executedAction"])),
        providerStatuses,
      },
    }
  }
}

const deleteDeployArgs = {
  names: new StringsParameter({
    help: "The name(s) of the deploy(s) (or services if using modules) to delete. You may specify multiple names, separated by spaces.",
    spread: true,
    getSuggestions: ({ configDump }) => {
      return Object.keys(configDump.actionConfigs.Deploy)
    },
  }),
}
type DeleteDeployArgs = typeof deleteDeployArgs

const deleteDeployOpts = {
  ...dependantsFirstOpt,
  "with-dependants": new BooleanParameter({
    help: deline`
      Also clean up deployments/services that have dependencies on one of the deployments/services specified as CLI arguments
      (recursively).  When used, this option implies --dependants-first. Note: This option has no effect unless a list
      of names is specified as CLI arguments (since then, every deploy/service in the project will be deleted).
    `,
  }),
}
type DeleteDeployOpts = typeof deleteDeployOpts

export class DeleteDeployCommand extends Command<DeleteDeployArgs, DeleteDeployOpts> {
  name = "deploy"
  aliases = ["deploys", "service", "services"]
  help = "Cleans up running deployments (or services if using modules)."
  arguments = deleteDeployArgs

  protected = true
  workflows = true
  streamEvents = true

  options = deleteDeployOpts

  description = dedent`
    Cleans up (i.e. un-deploys) the specified actions. Cleans up all deploys/services in the project if no arguments are provided.
    Note that this command does not take into account any deploys depending on the cleaned up actions, and might
    therefore leave the project in an unstable state. Running \`garden deploy\` after will re-deploy anything missing.

    Examples:

        garden cleanup deploy my-service # deletes my-service
        garden cleanup deploy            # deletes all deployed services in the project
  `

  outputsSchema = () =>
    joiIdentifierMap(
      getDeployStatusSchema().keys({
        version: joi.string(),
      })
    ).description("A map of statuses for all the deleted deploys.")

  printHeader({ log }) {
    printHeader(log, "Cleaning up deployment(s)", "♻️")
  }

  async action({ garden, log, args, opts }: CommandParams<DeleteDeployArgs, DeleteDeployOpts>): Promise<CommandResult> {
    const graph = await garden.getConfigGraph({ log, emit: true })
    let actions = graph.getDeploys({ names: args.names })

    if (actions.length === 0) {
      log.warn({ msg: "No deploys found. Aborting." })
      return { result: {} }
    }

    if (opts["with-dependants"]) {
      // Then we include service dependants (recursively) in the list of services to delete
      actions = uniqByName([
        ...actions,
        ...actions.flatMap((s) =>
          graph.getDependants({ kind: "Deploy", name: s.name, recursive: true }).filter(isDeployAction)
        ),
      ])
    }

    const dependantsFirst = opts["dependants-first"] || opts["with-dependants"]
    const deleteDeployNames = actions.map((a) => a.name)

    const tasks = actions.map((action) => {
      return new DeleteDeployTask({
        garden,
        graph,
        log,
        action,
        deleteDeployNames,
        dependantsFirst,
        force: false,
        forceActions: [],
      })
    })

    const processed = await garden.processTasks({ tasks, log })
    const result = deletedDeployStatuses(processed.results)

    log.info(chalk.green("\nDone!"))

    return { result }
  }
}
