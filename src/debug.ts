import * as core from '@actions/core';

export function debug(title: string, content: any) {
  if (core.isDebug()) {
    core.info(`::group::${title}`);
    try {
      core.debug(JSON.stringify(content, null, 3));
    } catch(e) {
      core.debug(`Failed to serialize object, trying toString. Cause: ${e}`);
      core.debug(content?.toString());
    }
    core.info('::endgroup::');
  }
}
