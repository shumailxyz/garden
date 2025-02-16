/*
 * Copyright (C) 2018-2023 Garden Technologies, Inc. <info@garden.io>
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { mapValues } from "lodash"
import Cryo from "cryo"
import { writeFile } from "fs-extra"
import { DumpOptions, dump } from "js-yaml"
import highlight from "cli-highlight"
import chalk from "chalk"

export async function dumpYaml(yamlPath: string, data: any) {
  return writeFile(yamlPath, safeDumpYaml(data, { noRefs: true }))
}

/**
 * Wraps safeDump and enforces that invalid values are skipped
 */
export function safeDumpYaml(data: any, opts: DumpOptions = {}) {
  return dump(data, { ...opts, skipInvalid: true })
}

/**
 * Encode multiple objects as one multi-doc YAML file
 */
export function encodeYamlMulti(objects: object[]) {
  return objects.map((s) => safeDumpYaml(s, { noRefs: true }) + "---\n").join("")
}

export function highlightYaml(s: string) {
  return highlight(s, {
    language: "yaml",
    theme: {
      keyword: chalk.white.italic,
      literal: chalk.white.italic,
      string: chalk.white,
    },
  })
}

/**
 * Encode and write multiple objects as a multi-doc YAML file
 */
export async function dumpYamlMulti(yamlPath: string, objects: object[]) {
  return writeFile(yamlPath, encodeYamlMulti(objects))
}

export function serializeObject(o: any): string {
  return Buffer.from(Cryo.stringify(o)).toString("base64")
}

export function deserializeObject(s: string) {
  return Cryo.parse(Buffer.from(s, "base64"))
}

export function serializeValues(o: { [key: string]: any }): { [key: string]: string } {
  return mapValues(o, serializeObject)
}

export function deserializeValues(o: object) {
  return mapValues(o, deserializeObject)
}
