/*
 * Copyright (C) 2018-2023 Garden Technologies, Inc. <info@garden.io>
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { expect } from "chai"
import { join } from "path"

import { createGardenPlugin } from "@garden-io/sdk"
import { makeTestGarden } from "@garden-io/sdk/testing"
import { gardenPlugin } from ".."
import { gardenPlugin as conftestPlugin } from "@garden-io/garden-conftest"

import { ProjectConfig, defaultNamespace } from "@garden-io/core/build/src/config/project"
import { defaultDotIgnoreFile } from "@garden-io/core/build/src/util/fs"
import { defaultDockerfileName } from "@garden-io/core/build/src/plugins/container/config"
import { DEFAULT_BUILD_TIMEOUT_SEC, GardenApiVersion } from "@garden-io/core/build/src/constants"

describe.skip("conftest-container provider", () => {
  const projectRoot = join(__dirname, "test-project")

  const projectConfig: ProjectConfig = {
    apiVersion: GardenApiVersion.v1,
    kind: "Project",
    name: "test",
    path: projectRoot,
    defaultEnvironment: "default",
    dotIgnoreFile: defaultDotIgnoreFile,
    environments: [{ name: "default", defaultNamespace, variables: {} }],
    providers: [{ name: "conftest-container", policyPath: "dockerfile.rego" }],
    variables: {},
  }

  it("should add a conftest module for each container module with a Dockerfile", async () => {
    const garden = await makeTestGarden(projectRoot, {
      plugins: [gardenPlugin(), conftestPlugin()],
      config: projectConfig,
    })

    const graph = await garden.getConfigGraph({ log: garden.log, emit: false })
    const containerModule = graph.getModule("container")
    const module = graph.getModule("conftest-container")

    expect(module.path).to.equal(containerModule.path)
    expect(module.spec).to.eql({
      build: { dependencies: [], timeout: 1200 },
      files: [defaultDockerfileName],
      namespace: "main",
      combine: false,
      policyPath: "dockerfile.rego",
    })
  })

  it("should add a conftest module for module types inheriting from container", async () => {
    const foo = createGardenPlugin({
      name: "foo",
      dependencies: [{ name: "container" }],
      createModuleTypes: [
        {
          name: "foo",
          base: "container",
          docs: "foo",
          needsBuild: true,
          handlers: {},
        },
      ],
    })

    const garden = await makeTestGarden(projectRoot, {
      plugins: [gardenPlugin(), conftestPlugin(), foo],
      config: {
        ...projectConfig,
        providers: [...projectConfig.providers, { name: "foo" }],
      },
    })

    let graph = await garden.getConfigGraph({ log: garden.log, emit: false })
    const containerModule = graph.getModule("container")

    garden["moduleConfigs"] = {
      foo: {
        apiVersion: GardenApiVersion.v0,
        name: "foo",
        type: "foo",
        allowPublish: false,
        build: { dependencies: [], timeout: DEFAULT_BUILD_TIMEOUT_SEC },
        disabled: false,
        path: containerModule.path,
        serviceConfigs: [],
        taskConfigs: [],
        testConfigs: [],
        spec: { dockerfile: defaultDockerfileName },
      },
    }

    graph = await garden.getConfigGraph({ log: garden.log, emit: false })
    const module = graph.getModule("conftest-foo")

    expect(module.path).to.equal(projectRoot)
    expect(module.spec).to.eql({
      build: { dependencies: [], timeout: 1200 },
      files: [defaultDockerfileName],
      namespace: "main",
      combine: false,
      policyPath: "dockerfile.rego",
    })
  })
})
