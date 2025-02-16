/*
 * Copyright (C) 2018-2023 Garden Technologies, Inc. <info@garden.io>
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { ContainerDeployAction } from "../../container/moduleConfig"
import { getAppNamespace } from "../namespace"
import { streamK8sLogs } from "../logs"
import { KubernetesPluginContext } from "../config"
import { createWorkloadManifest } from "./deployment"
import { KubeApi } from "../api"
import { DeployActionHandler } from "../../../plugin/action-types"
import { getDeployedImageId } from "./util"

export const k8sGetContainerDeployLogs: DeployActionHandler<"getLogs", ContainerDeployAction> = async (params) => {
  const { ctx, log, action } = params
  const k8sCtx = <KubernetesPluginContext>ctx
  const provider = k8sCtx.provider
  const namespace = await getAppNamespace(k8sCtx, log, provider)
  const api = await KubeApi.factory(log, ctx, provider)

  const imageId = getDeployedImageId(action, provider)

  const resources = [
    await createWorkloadManifest({
      ctx: k8sCtx,
      api,
      provider,
      action,
      imageId,
      namespace,

      production: ctx.production,
      log,
    }),
  ]

  return streamK8sLogs({ ...params, provider, defaultNamespace: namespace, resources, actionName: action.name })
}
