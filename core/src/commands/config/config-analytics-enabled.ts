/*
 * Copyright (C) 2018-2023 Garden Technologies, Inc. <info@garden.io>
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { Command, CommandParams, CommandResult } from "../base"
import dedent = require("dedent")
import { BooleanParameter } from "../../cli/params"

const configAnalyticsEnabledArgs = {
  enable: new BooleanParameter({
    help: 'Enable analytics. Defaults to "true"',
    defaultValue: true,
  }),
}

type Args = typeof configAnalyticsEnabledArgs

export class ConfigAnalyticsEnabled extends Command {
  name = "analytics-enabled"
  noProject = true
  help = "Update your preferences regarding analytics."

  arguments = configAnalyticsEnabledArgs

  description = dedent`
    To help us make Garden better, we collect some analytics data about its usage.
    We make sure all the data collected is anonymized and stripped of sensitive
    information. We collect data about which commands are run, what tasks they trigger,
    which API calls are made to your local Garden server, as well as some info
    about the environment in which Garden runs.

    You will be asked if you want to opt out when running Garden for the
    first time and you can use this command to update your preferences later.

    Examples:

        garden config analytics-enabled true   # enable analytics
        garden config analytics-enabled false  # disable analytics
  `

  // Skip printing header
  printHeader() {}

  async action({ garden, log, args }: CommandParams<Args>): Promise<CommandResult> {
    const analyticsClient = await garden.getAnalyticsHandler()
    await analyticsClient.setAnalyticsOptOut(!args.enable)

    if (args.enable) {
      log.success(`Thanks for helping us make Garden better! Anonymized analytics collection is now active.`)
    } else {
      log.success(`The collection of anonymous CLI usage data is now disabled.`)
    }

    return {}
  }
}
