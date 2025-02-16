/*
 * Copyright (C) 2018-2023 Garden Technologies, Inc. <info@garden.io>
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import tmp from "tmp-promise"
import { createProjectConfig, makeTempDir, TestGarden } from "../../helpers"
import { resolveProjectOutputs } from "../../../src/outputs"
import { expect } from "chai"
import { realpath } from "fs-extra"
import { createGardenPlugin } from "../../../src/plugin/plugin"
import { ProjectConfig } from "../../../src/config/project"
import { DEFAULT_BUILD_TIMEOUT_SEC, GardenApiVersion } from "../../../src/constants"
import { joi } from "../../../src/config/common"

describe("resolveProjectOutputs", () => {
  let tmpDir: tmp.DirectoryResult
  let tmpPath: string
  let projectConfig: ProjectConfig

  beforeEach(async () => {
    tmpDir = await makeTempDir({ git: true, initialCommit: false })
    tmpPath = await realpath(tmpDir.path)

    projectConfig = createProjectConfig({
      path: tmpPath,
      providers: [{ name: "test" }],
    })
  })

  afterEach(async () => {
    await tmpDir.cleanup()
  })

  it("should return immediately if there are no outputs specified", async () => {
    const garden = await TestGarden.factory(tmpPath, {
      config: projectConfig,
    })
    const outputs = await resolveProjectOutputs(garden, garden.log)
    expect(outputs).to.eql([])
  })

  it("should resolve provider output template references", async () => {
    const plugin = createGardenPlugin({
      name: "test",
      handlers: {
        async getEnvironmentStatus() {
          return { ready: true, outputs: { test: "test-value" } }
        },
      },
    })

    projectConfig.outputs = [{ name: "test", value: "${providers.test.outputs.test}" }]

    const garden = await TestGarden.factory(tmpPath, {
      plugins: [plugin],
      config: projectConfig,
    })

    const outputs = await resolveProjectOutputs(garden, garden.log)
    expect(outputs).to.eql([{ name: "test", value: "test-value" }])
  })

  it("should resolve module output template references", async () => {
    const plugin = createGardenPlugin({
      name: "test",
      handlers: {
        async getEnvironmentStatus() {
          return { ready: true, outputs: { test: "test-value" } }
        },
      },
      createModuleTypes: [
        {
          name: "test",
          docs: "test",
          needsBuild: false,
          handlers: {
            async getModuleOutputs({ moduleConfig }) {
              return { outputs: moduleConfig.spec.outputs }
            },
            convert: async (_params) => ({}),
          },
        },
      ],
    })

    projectConfig.outputs = [{ name: "test", value: "${modules.test.outputs.test}" }]

    const garden = await TestGarden.factory(tmpPath, {
      plugins: [plugin],
      config: projectConfig,
    })

    garden.setModuleConfigs([
      {
        apiVersion: GardenApiVersion.v0,
        allowPublish: false,
        build: { dependencies: [], timeout: DEFAULT_BUILD_TIMEOUT_SEC },
        disabled: false,
        name: "test",
        path: tmpPath,
        serviceConfigs: [],
        taskConfigs: [],
        spec: {
          outputs: {
            test: "test-value",
          },
        },
        testConfigs: [],
        type: "test",
      },
    ])

    const outputs = await resolveProjectOutputs(garden, garden.log)
    expect(outputs).to.eql([{ name: "test", value: "test-value" }])
  })

  it("should resolve service runtime output references", async () => {
    const plugin = createGardenPlugin({
      name: "test",
      handlers: {},
      createModuleTypes: [
        {
          docs: "asd",
          name: "test",
          needsBuild: false,
          handlers: {
            convert: async (_params) => ({}),
          },
        },
      ],
      createActionTypes: {
        Deploy: [
          {
            docs: "asd",
            name: "test",
            schema: joi.object(),
            handlers: {
              getOutputs: async (params) => ({ outputs: params.action.getSpec().outputs }),
              getStatus: async (params) => ({
                detail: { outputs: params.action.getSpec().outputs, state: "ready", detail: {} },
                outputs: params.action.getSpec().outputs,
                state: "ready",
              }),
            },
          },
        ],
      },
    })

    projectConfig.outputs = [{ name: "test", value: "${runtime.services.test.outputs.test}" }]

    const garden = await TestGarden.factory(tmpPath, {
      plugins: [plugin],
      config: projectConfig,
    })

    garden.setActionConfigs([
      {
        name: "test",
        type: "test",
        internal: {
          basePath: "asd",
        },
        kind: "Deploy",
        spec: {
          outputs: {
            test: "test-value",
          },
        },
      },
    ])

    const outputs = await resolveProjectOutputs(garden, garden.log)
    expect(outputs).to.eql([{ name: "test", value: "test-value" }])
  })

  it("should resolve run runtime output references", async () => {
    const result = {
      detail: {
        success: true,
        completedAt: new Date(),
        log: "hello",
        startedAt: new Date(),
      },
      outputs: { log: "hello" },
      state: "ready" as "ready",
    }

    const plugin = createGardenPlugin({
      name: "test",
      handlers: {},
      createModuleTypes: [
        {
          docs: "asd",
          name: "test",
          needsBuild: false,
          handlers: {
            convert: async (_params) => ({}),
          },
        },
      ],
      createActionTypes: {
        Run: [
          {
            docs: "asd",
            name: "test",
            schema: joi.object(),
            handlers: {
              getOutputs: async (params) => ({ outputs: params.action.getSpec().outputs }),
              run: async (_params) => result,
              getResult: async (_params) => result,
            },
          },
        ],
      },
    })

    projectConfig.outputs = [{ name: "test", value: "${runtime.tasks.test.outputs.log}" }]

    const garden = await TestGarden.factory(tmpPath, {
      plugins: [plugin],
      config: projectConfig,
    })

    garden.setActionConfigs([
      {
        name: "test",
        type: "test",
        internal: {
          basePath: "asd",
        },
        kind: "Run",
        spec: {
          outputs: {
            test: "test-value",
          },
        },
      },
    ])

    const outputs = await resolveProjectOutputs(garden, garden.log)
    expect(outputs).to.eql([{ name: "test", value: "hello" }])
  })
})
