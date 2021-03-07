import * as core from '@actions/core'
import YAML from 'yaml'

const asJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw)
  } catch (error) {
    core.debug(`Couldn't parse "${raw}" as JSON:`)
    core.debug(error)
  }

  return null
}

const asYaml = (raw: string): unknown => {
  try {
    return YAML.parse(raw)
  } catch (error) {
    core.debug(`Couldn't parse "${raw}" as YAML:`)
    core.debug(error)
  }

  return null
}

export const parse = (raw?: string): unknown => {
  if (!raw) {
    return {}
  }

  const result = asJson(raw) ?? asYaml(raw)

  if (!result) {
    throw new TypeError(`inputs "${raw}" is neither a valid JSON, nor a valid YAML.`)
  }

  core.debug(`inputs correctly parsed as: ${JSON.stringify(result, null, 2)}`)
  return result
}
