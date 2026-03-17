import path from 'path';
import { Octokit } from '@octokit/rest';
import { RuntimeInputs } from '../core/inputs';
import { ensureDockerAvailable, failAndExit } from '../core/actionUtils';
import { createLogger } from '../core/logger';
import { WorkflowContext } from './types';

export function createWorkflowContext(inputs: RuntimeInputs): WorkflowContext {
  const logger = createLogger('workflow');
  const absRepoPath = path.resolve(process.cwd(), inputs.repoPath);
  logger.info('Repository path:', absRepoPath);

  const dockerError = ensureDockerAvailable();
  if (dockerError) {
    failAndExit(dockerError);
  }

  return {
    absRepoPath,
    octo: new Octokit({ auth: inputs.token }),
    issueTracker: new Set<string>(),
    logger,
  };
}
